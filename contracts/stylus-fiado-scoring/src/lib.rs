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
//! - `fiado_enabled` defaults to `false` for every bodega and can only be toggled by the
//!   bodega itself (keyed on `msg.sender`, no separate access-control list needed). Real
//!   bodegas don't always fiar — it's the owner's call ("hoy no se fía, mañana sí") — so the
//!   frontend hides the fiado UI entirely unless the bodega has opted in. Payment history and
//!   scoring still accumulate regardless, so there's already a track record the moment a
//!   bodega flips the switch on.
//! - `credit_limit` alone was only ever a suggested ceiling, not an actual ledger — nothing
//!   tracked how much of it a bodega had actually lent out, or to whom. `extend_fiado` /
//!   `repay_fiado` add that missing debt ledger: `fiado_debt[bodega][customer]` tracks what
//!   a specific customer owes a specific bodega, and `total_outstanding[bodega]` caps new
//!   extensions at the bodega's own `credit_limit`. `extend_fiado` is a direct bodega call
//!   (same `msg.sender`-keyed pattern as `set_fiado_enabled`, since no money moves when a
//!   bodega fiar's someone); `repay_fiado` is `payment_router`-gated like `record_payment`,
//!   since real ETH changes hands in `PaymentRouter.payFiado` before this updates the ledger.
//! - `update_score_from_ai` is a circuit breaker, not a blank check: the AI can raise a
//!   bodega's `credit_limit` to at most 2x what `heuristic_score_and_limit` would compute for
//!   it right now from the real payment history (lowering it is always unrestricted — being
//!   more conservative than the heuristic is never a risk). This bounds the blast radius of a
//!   leaked `ai_oracle` key: even with the key, nobody can hand a bodega with no track record
//!   an arbitrary fiado limit — the ceiling is still anchored to real on-chain history.
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
    #[derive(Debug)]
    error ZeroAmount();
    #[derive(Debug)]
    error FiadoNotEnabled();
    #[derive(Debug)]
    error InsufficientLimit();
    #[derive(Debug)]
    error AiLimitOutOfRange();

    event PaymentRecorded(address indexed bodega, uint256 amount, uint256 timestamp);
    event ScoreUpdated(address indexed bodega, uint256 score, uint256 creditLimit, bool aiAdjusted);
    event FiadoExtended(address indexed bodega, address indexed customer, uint256 amount);
    event FiadoRepaid(address indexed bodega, address indexed customer, uint256 amount);
}

/// How far above the heuristic's own credit limit the AI oracle is allowed to push a
/// bodega's limit. See the module doc comment for why this cap exists.
const AI_LIMIT_MULTIPLIER_CAP: u64 = 2;

#[derive(Debug, SolidityError)]
pub enum FiadoError {
    Unauthorized(Unauthorized),
    ZeroAddress(ZeroAddress),
    ZeroAmount(ZeroAmount),
    FiadoNotEnabled(FiadoNotEnabled),
    InsufficientLimit(InsufficientLimit),
    AiLimitOutOfRange(AiLimitOutOfRange),
}

sol_storage! {
    #[entrypoint]
    pub struct FiadoScoring {
        address owner;
        address payment_router;
        address ai_oracle;
        address escrow;

        mapping(address => uint256[12]) recent_amounts;
        mapping(address => uint256[12]) recent_timestamps;
        mapping(address => uint256) recent_cursor;
        mapping(address => uint256) recent_count;

        mapping(address => uint256) score;
        mapping(address => uint256) credit_limit;
        mapping(address => bool) ai_adjusted;
        mapping(address => uint256) ai_adjusted_at;

        mapping(address => bool) fiado_enabled;

        mapping(address => mapping(address => uint256)) fiado_debt;
        mapping(address => uint256) total_outstanding;
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

    pub fn escrow(&self) -> Address {
        self.escrow.get()
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

    /// Sets the InvoiceEscrow contract address — the only caller allowed to call
    /// `extend_fiado_for` (fiado extended on behalf of a bodega, for the collateral-backed
    /// path) and, alongside `payment_router`, to call `repay_fiado` (a collateral claim on
    /// default is also a debt repayment, from the ledger's point of view).
    pub fn set_escrow(&mut self, escrow: Address) -> Result<(), FiadoError> {
        self.only_owner()?;
        if escrow.is_zero() {
            return Err(FiadoError::ZeroAddress(ZeroAddress {}));
        }
        self.escrow.set(escrow);
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

    /// Whether `bodega` currently offers fiado. Defaults to `false` — fiado is opt-in per
    /// bodega, not automatic just because a payment history exists.
    pub fn is_fiado_enabled(&self, bodega: Address) -> bool {
        self.fiado_enabled.get(bodega)
    }

    /// Turns fiado on/off for the caller's own bodega. Only the bodega itself can do this —
    /// there's no separate registry to check, since keying on `msg.sender` already scopes it.
    pub fn set_fiado_enabled(&mut self, enabled: bool) {
        let bodega = self.vm().msg_sender();
        self.fiado_enabled.setter(bodega).set(enabled);
    }

    /// Bodega extends fiado (credit) to a specific customer — the actual IOU a "fiado
    /// inteligente" promise needs, on top of the suggested ceiling `credit_limit` already
    /// provides. No money moves here: the customer takes goods now and owes `amount` to
    /// `bodega`. Keyed on `msg.sender` like `set_fiado_enabled` (only a bodega can fiar its
    /// own customers), capped by the bodega's own available room so it can never fiar more
    /// than its track record supports.
    pub fn extend_fiado(&mut self, customer: Address, amount: U256) -> Result<(), FiadoError> {
        let bodega = self.vm().msg_sender();
        self.extend_fiado_internal(bodega, customer, amount)
    }

    /// Same as `extend_fiado`, but `bodega` is passed explicitly instead of taken from
    /// `msg.sender` — restricted to the `escrow` contract, which calls this on a bodega's
    /// behalf the moment a customer accepts a collateral-backed invoice (InvoiceEscrow's
    /// `acceptInvoice`). Everything else (fiado-enabled check, credit-limit cap) is identical
    /// to `extend_fiado`, so the collateral-backed debt counts toward the same score/history
    /// as ordinary fiado.
    pub fn extend_fiado_for(&mut self, bodega: Address, customer: Address, amount: U256) -> Result<(), FiadoError> {
        if self.vm().msg_sender() != self.escrow.get() {
            return Err(FiadoError::Unauthorized(Unauthorized {}));
        }
        self.extend_fiado_internal(bodega, customer, amount)
    }

    /// Records a fiado repayment from `customer` to `bodega`. Restricted to `payment_router`
    /// or `escrow` — same trust boundary as `record_payment`, widened to `escrow` because a
    /// collateral claim on a defaulted invoice (InvoiceEscrow's `claimCollateral`) is also a
    /// debt repayment from the ledger's point of view, and a partial repayment through
    /// InvoiceEscrow's own `repayInvoice` needs the same access. In both cases the actual ETH
    /// already moved before this call; this just updates the debt ledger. Caps the deduction
    /// at the outstanding debt so an over-payment can't underflow the balance.
    pub fn repay_fiado(&mut self, bodega: Address, customer: Address, amount: U256) -> Result<(), FiadoError> {
        let sender = self.vm().msg_sender();
        if sender != self.payment_router.get() && sender != self.escrow.get() {
            return Err(FiadoError::Unauthorized(Unauthorized {}));
        }

        let current_debt = self.fiado_debt.getter(bodega).get(customer);
        let deducted = amount.min(current_debt);

        self.fiado_debt.setter(bodega).setter(customer).set(current_debt - deducted);

        let outstanding = self.total_outstanding.get(bodega);
        self.total_outstanding.setter(bodega).set(outstanding.saturating_sub(deducted));

        self.vm().log(FiadoRepaid { bodega, customer, amount: deducted });
        Ok(())
    }

    /// Current outstanding fiado debt that `customer` owes `bodega`.
    pub fn get_fiado_debt(&self, bodega: Address, customer: Address) -> U256 {
        self.fiado_debt.getter(bodega).get(customer)
    }

    /// How much fiado `bodega` still has room to extend right now: its credit limit minus
    /// what's already outstanding across all its customers.
    pub fn get_available_fiado(&self, bodega: Address) -> U256 {
        self.credit_limit.get(bodega).saturating_sub(self.total_outstanding.get(bodega))
    }

    /// Total fiado currently outstanding for `bodega`, summed across all its customers.
    pub fn get_total_outstanding(&self, bodega: Address) -> U256 {
        self.total_outstanding.get(bodega)
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

    /// Overrides the heuristic score/limit with the AI module's recommendation, bounded by
    /// the circuit breaker described in the module doc comment: `limit` can be at most
    /// `AI_LIMIT_MULTIPLIER_CAP`x what the heuristic itself would compute right now.
    /// Lowering the limit below the heuristic's is always allowed, uncapped.
    pub fn update_score_from_ai(&mut self, bodega: Address, score: U256, limit: U256) -> Result<(), FiadoError> {
        if self.vm().msg_sender() != self.ai_oracle.get() {
            return Err(FiadoError::Unauthorized(Unauthorized {}));
        }
        if score > U256::from(MAX_SCORE) {
            return Err(FiadoError::AiLimitOutOfRange(AiLimitOutOfRange {}));
        }

        let (_, heuristic_limit) = self.heuristic_score_and_limit(bodega);
        let max_allowed_limit = heuristic_limit.saturating_mul(U256::from(AI_LIMIT_MULTIPLIER_CAP));
        if limit > max_allowed_limit {
            return Err(FiadoError::AiLimitOutOfRange(AiLimitOutOfRange {}));
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

    /// Shared debt-ledger update behind both `extend_fiado` and `extend_fiado_for` — the only
    /// difference between the two public entry points is how `bodega` is determined
    /// (`msg.sender` vs. an escrow-supplied parameter); the fiado-enabled check, credit-limit
    /// cap, ledger update and event are identical either way.
    fn extend_fiado_internal(&mut self, bodega: Address, customer: Address, amount: U256) -> Result<(), FiadoError> {
        if amount.is_zero() {
            return Err(FiadoError::ZeroAmount(ZeroAmount {}));
        }
        if !self.fiado_enabled.get(bodega) {
            return Err(FiadoError::FiadoNotEnabled(FiadoNotEnabled {}));
        }

        let outstanding = self.total_outstanding.get(bodega);
        let limit = self.credit_limit.get(bodega);
        if outstanding.saturating_add(amount) > limit {
            return Err(FiadoError::InsufficientLimit(InsufficientLimit {}));
        }

        let current_debt = self.fiado_debt.getter(bodega).get(customer);
        self.fiado_debt.setter(bodega).setter(customer).set(current_debt.saturating_add(amount));
        self.total_outstanding.setter(bodega).set(outstanding.saturating_add(amount));

        self.vm().log(FiadoExtended { bodega, customer, amount });
        Ok(())
    }

    /// Moving-average / frequency / mora heuristic over the bounded ring buffer, as a pure
    /// read — no storage writes. Shared by `recompute_heuristic` (which persists the result
    /// after `record_payment`) and `update_score_from_ai` (which uses it as the circuit
    /// breaker's reference point, so a leaked `ai_oracle` key can at most double what the
    /// real payment history already justifies, never invent credit from nothing). See the
    /// module doc comment for why this loop is the reason to use Stylus here.
    fn heuristic_score_and_limit(&self, bodega: Address) -> (u64, U256) {
        let count = self.recent_count.get(bodega).to::<usize>().min(HISTORY_SIZE);
        if count == 0 {
            return (0, U256::ZERO);
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

        // Credit limit: average payment size scaled by score (out of MAX_SCORE), times a
        // fixed multiplier — deliberately simple for the MVP; the AI oracle path is where a
        // more nuanced recommendation comes in (bounded by AI_LIMIT_MULTIPLIER_CAP above).
        let limit = avg_amount
            .saturating_mul(U256::from(final_score))
            / U256::from(MAX_SCORE)
            * U256::from(3u64);

        (final_score, limit)
    }

    /// Persists `heuristic_score_and_limit`'s result and clears the AI-adjusted flag, since
    /// a fresh heuristic recompute overwrites the AI's number until the AI runs again.
    fn recompute_heuristic(&mut self, bodega: Address) {
        let (final_score, limit) = self.heuristic_score_and_limit(bodega);
        self.score.setter(bodega).set(U256::from(final_score));
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
        let router = Address::from([2u8; 20]);
        let oracle = Address::from([4u8; 20]);
        let bodega = Address::from([3u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();
        contract.set_ai_oracle(oracle).unwrap();

        // The circuit breaker anchors the AI's limit to the heuristic's own, so build some
        // real history first instead of adjusting a bodega with zero track record.
        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();
        let heuristic_limit = contract.get_credit_limit(bodega);

        vm.set_sender(oracle);
        contract.update_score_from_ai(bodega, U256::from(750), heuristic_limit).unwrap();

        assert_eq!(contract.get_score(bodega), U256::from(750));
        assert_eq!(contract.get_credit_limit(bodega), heuristic_limit);
        let (ai_adjusted, _) = contract.get_ai_adjustment_info(bodega);
        assert!(ai_adjusted);
    }

    #[test]
    fn test_update_score_from_ai_rejects_limit_far_above_heuristic() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let oracle = Address::from([4u8; 20]);
        let bodega = Address::from([3u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();
        contract.set_ai_oracle(oracle).unwrap();

        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();
        let heuristic_limit = contract.get_credit_limit(bodega);

        vm.set_sender(oracle);
        // 10x the heuristic limit is well above the 2x circuit-breaker cap.
        let err = contract.update_score_from_ai(bodega, U256::from(900), heuristic_limit * U256::from(10u64));
        assert!(err.is_err());

        // A leaked oracle key can't invent a limit for a bodega with zero payment history
        // either — the heuristic limit is 0, so max_allowed is 0.
        let fresh_bodega = Address::from([7u8; 20]);
        let err2 = contract.update_score_from_ai(fresh_bodega, U256::from(900), U256::from(1));
        assert!(err2.is_err());

        // A score above MAX_SCORE is rejected regardless of the limit.
        let err3 = contract.update_score_from_ai(bodega, U256::from(1001), U256::ZERO);
        assert!(err3.is_err());
    }

    #[test]
    fn test_update_score_from_ai_can_lower_limit_below_heuristic_unrestricted() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let oracle = Address::from([4u8; 20]);
        let bodega = Address::from([3u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();
        contract.set_ai_oracle(oracle).unwrap();

        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();

        vm.set_sender(oracle);
        // A very conservative (near-zero) limit is always allowed, no matter the heuristic —
        // being more cautious than the heuristic is never a risk.
        contract.update_score_from_ai(bodega, U256::from(50), U256::from(1)).unwrap();
        assert_eq!(contract.get_credit_limit(bodega), U256::from(1));
    }

    #[test]
    fn test_fiado_enabled_defaults_off_and_only_self_toggles() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let bodega = Address::from([3u8; 20]);
        let other = Address::from([9u8; 20]);

        assert!(!contract.is_fiado_enabled(bodega));

        // `other` toggling only affects its own flag, never `bodega`'s.
        vm.set_sender(other);
        contract.set_fiado_enabled(true);
        assert!(!contract.is_fiado_enabled(bodega));
        assert!(contract.is_fiado_enabled(other));

        vm.set_sender(bodega);
        contract.set_fiado_enabled(true);
        assert!(contract.is_fiado_enabled(bodega));

        contract.set_fiado_enabled(false);
        assert!(!contract.is_fiado_enabled(bodega));
    }

    #[test]
    fn test_extend_fiado_requires_enabled_and_respects_limit() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let bodega = Address::from([3u8; 20]);
        let customer = Address::from([5u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();

        // Build up a payment history so credit_limit > 0.
        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();
        let limit = contract.get_credit_limit(bodega);
        assert!(limit > U256::ZERO);

        // Fiado is off by default — extending fails.
        vm.set_sender(bodega);
        assert!(contract.extend_fiado(customer, U256::from(1)).is_err());

        contract.set_fiado_enabled(true);

        // Zero amount is rejected.
        assert!(contract.extend_fiado(customer, U256::ZERO).is_err());

        // Extending past the limit is rejected.
        assert!(contract.extend_fiado(customer, limit + U256::from(1)).is_err());

        // A valid extension updates debt and available room.
        let half = limit / U256::from(2u64);
        contract.extend_fiado(customer, half).unwrap();
        assert_eq!(contract.get_fiado_debt(bodega, customer), half);
        assert_eq!(contract.get_total_outstanding(bodega), half);
        assert_eq!(contract.get_available_fiado(bodega), limit - half);
    }

    #[test]
    fn test_repay_fiado_reduces_debt_caps_overpayment_and_is_router_gated() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let bodega = Address::from([3u8; 20]);
        let customer = Address::from([5u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();

        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();

        vm.set_sender(bodega);
        contract.set_fiado_enabled(true);
        let debt = U256::from(1_000_000_000_000_000u128);
        contract.extend_fiado(customer, debt).unwrap();

        // Only the router can repay — a random caller (even the bodega itself) can't.
        assert!(contract.repay_fiado(bodega, customer, debt).is_err());

        vm.set_sender(router);
        // Overpaying caps at the outstanding debt instead of underflowing.
        contract.repay_fiado(bodega, customer, debt + U256::from(999)).unwrap();
        assert_eq!(contract.get_fiado_debt(bodega, customer), U256::ZERO);
        assert_eq!(contract.get_total_outstanding(bodega), U256::ZERO);
        assert_eq!(contract.get_available_fiado(bodega), contract.get_credit_limit(bodega));
    }

    #[test]
    fn test_set_escrow_is_owner_gated_and_rejects_zero() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let escrow = Address::from([6u8; 20]);
        let other = Address::from([9u8; 20]);

        contract.constructor(owner).unwrap();

        // Not the owner.
        vm.set_sender(other);
        assert!(contract.set_escrow(escrow).is_err());

        vm.set_sender(owner);
        assert!(contract.set_escrow(Address::ZERO).is_err());
        contract.set_escrow(escrow).unwrap();
        assert_eq!(contract.escrow(), escrow);
    }

    #[test]
    fn test_extend_fiado_for_is_escrow_gated_and_shares_extend_fiado_rules() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let escrow = Address::from([6u8; 20]);
        let bodega = Address::from([3u8; 20]);
        let customer = Address::from([5u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();
        contract.set_escrow(escrow).unwrap();

        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();
        let limit = contract.get_credit_limit(bodega);

        // Only the escrow contract can call this, not the bodega itself nor the router.
        vm.set_sender(bodega);
        assert!(contract.extend_fiado_for(bodega, customer, U256::from(1)).is_err());
        vm.set_sender(router);
        assert!(contract.extend_fiado_for(bodega, customer, U256::from(1)).is_err());

        // Same fiado_enabled/limit rules as extend_fiado apply once called by escrow.
        vm.set_sender(escrow);
        assert!(contract.extend_fiado_for(bodega, customer, U256::from(1)).is_err());

        vm.set_sender(bodega);
        contract.set_fiado_enabled(true);

        vm.set_sender(escrow);
        assert!(contract.extend_fiado_for(bodega, customer, limit + U256::from(1)).is_err());

        let half = limit / U256::from(2u64);
        contract.extend_fiado_for(bodega, customer, half).unwrap();
        assert_eq!(contract.get_fiado_debt(bodega, customer), half);
        assert_eq!(contract.get_total_outstanding(bodega), half);
    }

    #[test]
    fn test_repay_fiado_accepts_escrow_or_router_rejects_others() {
        let vm = TestVM::default();
        let mut contract = FiadoScoring::from(&vm);

        let owner = Address::from([1u8; 20]);
        let router = Address::from([2u8; 20]);
        let escrow = Address::from([6u8; 20]);
        let bodega = Address::from([3u8; 20]);
        let customer = Address::from([5u8; 20]);

        contract.constructor(owner).unwrap();
        vm.set_sender(owner);
        contract.set_payment_router(router).unwrap();
        contract.set_escrow(escrow).unwrap();

        vm.set_sender(router);
        vm.set_block_timestamp(1_000_000);
        contract.record_payment(bodega, U256::from(1_000_000_000_000_000_000u128), U256::ZERO).unwrap();

        vm.set_sender(bodega);
        contract.set_fiado_enabled(true);
        let debt = U256::from(1_000_000_000_000_000u128);
        contract.extend_fiado(customer, debt).unwrap();

        // Neither the bodega nor a random address can repay.
        assert!(contract.repay_fiado(bodega, customer, debt).is_err());

        // The escrow contract can (e.g. a collateral claim on default).
        vm.set_sender(escrow);
        let claimed = debt / U256::from(2u64);
        contract.repay_fiado(bodega, customer, claimed).unwrap();
        assert_eq!(contract.get_fiado_debt(bodega, customer), debt - claimed);

        // The router still can too (ordinary PaymentRouter.payFiado path is unaffected).
        vm.set_sender(router);
        contract.repay_fiado(bodega, customer, debt - claimed).unwrap();
        assert_eq!(contract.get_fiado_debt(bodega, customer), U256::ZERO);
    }
}
