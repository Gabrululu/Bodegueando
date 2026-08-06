//! FiadoScoring — Arbitrum Stylus (Rust/WASM) contract for Bodegueando.
//!
//! Design decisions (why this lives in Stylus instead of Solidity):
//!
//! - Each bodega's recent-payment history is a bounded ring buffer (`HISTORY_SIZE` entries)
//!   in contract storage, not an unbounded array. Every `record_payment` call recomputes a
//!   heuristic score/credit-limit by walking that fixed-size buffer: a moving average of
//!   payment amounts, a payment-frequency signal (average gap between payments), and a
//!   time-since-last-payment ("mora") penalty. That's a small but nontrivial numeric loop —
//!   the kind of computation that's cheap in WASM and comparatively expensive in EVM opcodes,
//!   which is the concrete reason to use Stylus here rather than plain Solidity.
//! - `record_payment` is restricted to the configured `payment_router` address, so history
//!   can't be spoofed by an arbitrary caller.
//! - `update_score_from_ai` lets an off-chain AI module (the Next.js API route) override the
//!   heuristic score/limit, restricted to a configured `ai_oracle` address. An `ai_adjusted`
//!   flag + timestamp record whether the current number came from the heuristic or the AI, so
//!   the frontend can show that distinction. A new `record_payment` clears the flag, since the
//!   heuristic recompute overwrites the AI's number until the AI runs again.
//!
//! Note: this code is a hackathon-stage contract and has not been audited.

#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::vec::Vec;
use alloy_sol_types::sol;
use stylus_sdk::{
    alloy_primitives::{Address, U256},
    prelude::*,
};

/// Ring-buffer capacity. Must match the literal `12` used in the `sol_storage!` field
/// declarations below (the macro needs a literal, not this const, at those two spots).
const HISTORY_SIZE: usize = 12;
const MAX_SCORE: u64 = 1000;
const THIRTY_DAYS: u64 = 30 * 24 * 60 * 60;

sol! {
    #[derive(Debug)]
    error Unauthorized();
    #[derive(Debug)]
    error ZeroAddress();

    event PaymentRecorded(address indexed bodega, uint256 amount, uint256 timestamp);
    event ScoreUpdated(address indexed bodega, uint256 score, uint256 creditLimit, bool aiAdjusted);
}

#[derive(Debug, SolidityError)]
pub enum FiadoError {
    Unauthorized(Unauthorized),
    ZeroAddress(ZeroAddress),
}

sol_storage! {
    #[entrypoint]
    pub struct FiadoScoring {
        address owner;
        address payment_router;
        address ai_oracle;

        mapping(address => uint256[12]) recent_amounts;
        mapping(address => uint256[12]) recent_timestamps;
        mapping(address => uint256) recent_cursor;
        mapping(address => uint256) recent_count;

        mapping(address => uint256) score;
        mapping(address => uint256) credit_limit;
        mapping(address => bool) ai_adjusted;
        mapping(address => uint256) ai_adjusted_at;
    }
}

#[public]
impl FiadoScoring {
    #[constructor]
    pub fn constructor(&mut self, owner: Address) -> Result<(), Vec<u8>> {
        self.owner.set(owner);
        Ok(())
    }

    pub fn owner(&self) -> Address {
        self.owner.get()
    }

    pub fn payment_router(&self) -> Address {
        self.payment_router.get()
    }

    pub fn ai_oracle(&self) -> Address {
        self.ai_oracle.get()
    }

    pub fn set_payment_router(&mut self, router: Address) -> Result<(), FiadoError> {
        self.only_owner()?;
        if router.is_zero() {
            return Err(FiadoError::ZeroAddress(ZeroAddress {}));
        }
        self.payment_router.set(router);
        Ok(())
    }

    pub fn set_ai_oracle(&mut self, oracle: Address) -> Result<(), FiadoError> {
        self.only_owner()?;
        if oracle.is_zero() {
            return Err(FiadoError::ZeroAddress(ZeroAddress {}));
        }
        self.ai_oracle.set(oracle);
        Ok(())
    }

    /// Records a payment for `bodega` and recomputes its heuristic score/limit.
    /// `_timestamp` is accepted for ABI compatibility with the caller (PaymentRouter passes
    /// `block.timestamp`) but intentionally not trusted for the stored value — since the two
    /// contracts execute in the same transaction, `self.vm().block_timestamp()` is identical
    /// and doesn't depend on a caller-supplied argument.
    pub fn record_payment(&mut self, bodega: Address, amount: U256, _timestamp: U256) -> Result<(), FiadoError> {
        if self.vm().msg_sender() != self.payment_router.get() {
            return Err(FiadoError::Unauthorized(Unauthorized {}));
        }

        let now = U256::from(self.vm().block_timestamp());
        let cursor = self.recent_cursor.get(bodega).to::<usize>();

        let mut amounts_slot = self.recent_amounts.setter(bodega);
        if let Some(mut slot) = amounts_slot.setter(cursor) {
            slot.set(amount);
        }
        drop(amounts_slot);

        let mut timestamps_slot = self.recent_timestamps.setter(bodega);
        if let Some(mut slot) = timestamps_slot.setter(cursor) {
            slot.set(now);
        }
        drop(timestamps_slot);

        self.recent_cursor.setter(bodega).set(U256::from((cursor + 1) % HISTORY_SIZE));

        let count = self.recent_count.get(bodega).to::<usize>();
        if count < HISTORY_SIZE {
            self.recent_count.setter(bodega).set(U256::from(count + 1));
        }

        self.recompute_heuristic(bodega);

        self.vm().log(PaymentRecorded { bodega, amount, timestamp: now });
        Ok(())
    }

    pub fn get_credit_limit(&self, bodega: Address) -> U256 {
        self.credit_limit.get(bodega)
    }

    pub fn get_score(&self, bodega: Address) -> U256 {
        self.score.get(bodega)
    }

    pub fn get_ai_adjustment_info(&self, bodega: Address) -> (bool, U256) {
        (self.ai_adjusted.get(bodega), self.ai_adjusted_at.get(bodega))
    }

    pub fn get_payment_history(&self, bodega: Address) -> (Vec<U256>, Vec<U256>) {
        let count = self.recent_count.get(bodega).to::<usize>();
        let amounts_slot = self.recent_amounts.getter(bodega);
        let timestamps_slot = self.recent_timestamps.getter(bodega);

        let mut amounts = Vec::with_capacity(count);
        let mut timestamps = Vec::with_capacity(count);
        for i in 0..count {
            amounts.push(amounts_slot.get(i).unwrap_or_default());
            timestamps.push(timestamps_slot.get(i).unwrap_or_default());
        }
        (amounts, timestamps)
    }

    /// Overrides the heuristic score/limit with the AI module's recommendation.
    pub fn update_score_from_ai(&mut self, bodega: Address, score: U256, limit: U256) -> Result<(), FiadoError> {
        if self.vm().msg_sender() != self.ai_oracle.get() {
            return Err(FiadoError::Unauthorized(Unauthorized {}));
        }

        let now = U256::from(self.vm().block_timestamp());
        self.score.setter(bodega).set(score);
        self.credit_limit.setter(bodega).set(limit);
        self.ai_adjusted.setter(bodega).set(true);
        self.ai_adjusted_at.setter(bodega).set(now);

        self.vm().log(ScoreUpdated { bodega, score, creditLimit: limit, aiAdjusted: true });
        Ok(())
    }
}

impl FiadoScoring {
    fn only_owner(&self) -> Result<(), FiadoError> {
        if self.vm().msg_sender() != self.owner.get() {
            return Err(FiadoError::Unauthorized(Unauthorized {}));
        }
        Ok(())
    }

    /// Moving-average / frequency / mora heuristic over the bounded ring buffer. See the
    /// module doc comment for why this loop is the reason to use Stylus here.
    fn recompute_heuristic(&mut self, bodega: Address) {
        let count = self.recent_count.get(bodega).to::<usize>().min(HISTORY_SIZE);
        if count == 0 {
            self.score.setter(bodega).set(U256::ZERO);
            self.credit_limit.setter(bodega).set(U256::ZERO);
            self.ai_adjusted.setter(bodega).set(false);
            return;
        }

        let amounts_slot = self.recent_amounts.getter(bodega);
        let timestamps_slot = self.recent_timestamps.getter(bodega);

        let mut sum = U256::ZERO;
        let mut oldest_ts = u64::MAX;
        let mut newest_ts = 0u64;
        for i in 0..count {
            let amount = amounts_slot.get(i).unwrap_or_default();
            let ts = timestamps_slot.get(i).unwrap_or_default().wrapping_to::<u64>();
            sum = sum.saturating_add(amount);
            if ts < oldest_ts {
                oldest_ts = ts;
            }
            if ts > newest_ts {
                newest_ts = ts;
            }
        }
        let avg_amount = sum / U256::from(count as u64);
        let now = self.vm().block_timestamp();

        // Frequency: shorter average gap between payments -> higher score (0..=400).
        let frequency_score: u64 = if count >= 2 && newest_ts > oldest_ts {
            let span = newest_ts - oldest_ts;
            let avg_gap = span / (count as u64 - 1);
            400u64.saturating_sub(avg_gap.min(400))
        } else {
            100
        };

        // Volume: how full the history window is (0..=300).
        let volume_score: u64 = (count as u64 * 300) / HISTORY_SIZE as u64;

        // Mora penalty: time since the most recent payment (0..=300, subtracted).
        let since_last = now.saturating_sub(newest_ts);
        let mora_penalty: u64 = if since_last > THIRTY_DAYS {
            300
        } else {
            (since_last * 300) / THIRTY_DAYS
        };

        let base_score: u64 = 300;
        let raw_score = base_score + frequency_score + volume_score;
        let final_score = raw_score.saturating_sub(mora_penalty).min(MAX_SCORE);

        self.score.setter(bodega).set(U256::from(final_score));

        // Credit limit: average payment size scaled by score (out of MAX_SCORE), times a
        // fixed multiplier — deliberately simple for the MVP; the AI oracle path is where a
        // more nuanced recommendation comes in.
        let limit = avg_amount
            .saturating_mul(U256::from(final_score))
            / U256::from(MAX_SCORE)
            * U256::from(3u64);
        self.credit_limit.setter(bodega).set(limit);

        self.ai_adjusted.setter(bodega).set(false);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use stylus_sdk::testing::*;

    #[test]
    fn test_record_payment_and_score() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let bodega = Address::from([3u8; 20]);

        contract.constructor(owner).unwrap();

        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();

        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();

        // base_score(300) + frequency_score(100, <2 data points) + volume_score(1*300/12=25) + no mora penalty
        assert_eq!(contract.get_score(bodega), U256::from(425));
        assert!(contract.get_credit_limit(bodega) > U256::ZERO);

        let (amounts, timestamps) = contract.get_payment_history(bodega);
        assert_eq!(amounts.len(), 1);
        assert_eq!(timestamps.len(), 1);
        assert_eq!(amounts[0], U256::from(1_000_000_000_000_000_000u128));
    }

    #[test]
    fn test_record_payment_unauthorized() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);
        let bodega = Address::from([3u8; 20]);

        let err = contract.record_payment(bodega, U256::from(1), U256::ZERO);
        assert!(err.is_err());
    }

    #[test]
    fn test_update_score_from_ai() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let oracle = Address::from([4u8; 20]);
        let bodega = Address::from([3u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_ai_oracle(oracle).unwrap();

        vm.set_sender(oracle);
        contract.update_score_from_ai(bodega, U256::from(750), U256::from(500)).unwrap();

        assert_eq!(contract.get_score(bodega), U256::from(750));
        assert_eq!(contract.get_credit_limit(bodega), U256::from(500));
        let (ai_adjusted, _) = contract.get_ai_adjustment_info(bodega);
        assert!(ai_adjusted);
    }
}
