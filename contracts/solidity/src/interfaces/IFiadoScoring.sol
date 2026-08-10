// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Solidity-side interface for the FiadoScoring contract, which is deployed as an
/// Arbitrum Stylus (Rust/WASM) contract. Stylus contracts speak the same ABI/calling convention
/// as EVM contracts, so calling it from Solidity needs nothing beyond a normal interface + address
/// — that EVM/WASM interop is the point of using Stylus here.
///
/// Function names here are the camelCase selectors `cargo stylus export-abi` generates from the
/// snake_case Rust method names in `contracts/stylus-fiado-scoring/src/lib.rs` (the `#[public]`
/// macro auto-converts on export) — e.g. `record_payment` -> `recordPayment`. Keep this interface
/// in sync by re-running `cargo stylus export-abi` after changing the Rust contract's public API.
interface IFiadoScoring {
    /// @notice Record a completed payment for `bodega`. Restricted on the Stylus side to the
    /// configured payment_router address.
    function recordPayment(address bodega, uint256 amount, uint256 timestamp) external;

    /// @notice Current heuristic-or-AI-adjusted credit limit for `bodega`, in wei.
    function getCreditLimit(address bodega) external view returns (uint256);

    /// @notice Current score (0-1000) for `bodega`.
    function getScore(address bodega) external view returns (uint256);

    /// @notice Whether the current score/limit was last set by the AI oracle rather than the
    /// on-chain heuristic, plus the timestamp of that update.
    function getAiAdjustmentInfo(address bodega) external view returns (bool aiAdjusted, uint256 updatedAt);

    /// @notice The bounded recent-payment ring buffer for `bodega` (amounts in wei, parallel
    /// array of unix timestamps), used as context for the off-chain AI recommendation.
    function getPaymentHistory(address bodega) external view returns (uint256[] memory amounts, uint256[] memory timestamps);

    /// @notice Update the score/limit from the AI oracle. Restricted on the Stylus side to the
    /// configured ai_oracle address.
    function updateScoreFromAi(address bodega, uint256 score, uint256 limit) external;

    /// @notice Whether `bodega` currently offers fiado. Defaults to false — opt-in per bodega,
    /// not automatic just because a payment history exists.
    function isFiadoEnabled(address bodega) external view returns (bool);

    /// @notice Turns fiado on/off for the caller's own bodega (`msg.sender`). No separate
    /// registry check — only a bodega can toggle its own flag.
    function setFiadoEnabled(bool enabled) external;

    /// @notice Bodega (`msg.sender`) extends fiado credit to `customer`, for `amount` wei. No
    /// money moves — this is the IOU. Reverts if fiado isn't enabled for the caller or if it
    /// would push total outstanding past the caller's own credit limit.
    function extendFiado(address customer, uint256 amount) external;

    /// @notice Same as `extendFiado`, but `bodega` is passed explicitly instead of taken from
    /// `msg.sender`. Restricted on the Stylus side to the configured escrow address —
    /// InvoiceEscrow calls this on a bodega's behalf the moment a customer accepts a
    /// collateral-backed invoice, so that debt counts toward the same score/history as
    /// ordinary fiado.
    function extendFiadoFor(address bodega, address customer, uint256 amount) external;

    /// @notice Records a fiado repayment from `customer` to `bodega`. Restricted on the Stylus
    /// side to the configured payment_router or escrow address — called from
    /// `PaymentRouter.payFiado` after the real ETH transfer to `bodega` already happened, or
    /// from InvoiceEscrow's `repayInvoice`/`claimCollateral` for the collateral-backed path.
    function repayFiado(address bodega, address customer, uint256 amount) external;

    /// @notice The InvoiceEscrow contract address currently authorized to call
    /// `extendFiadoFor` and `repayFiado`.
    function escrow() external view returns (address);

    /// @notice Current outstanding fiado debt that `customer` owes `bodega`, in wei.
    function getFiadoDebt(address bodega, address customer) external view returns (uint256);

    /// @notice How much fiado `bodega` still has room to extend right now (credit limit minus
    /// what's already outstanding across all its customers).
    function getAvailableFiado(address bodega) external view returns (uint256);

    /// @notice Total fiado currently outstanding for `bodega`, summed across all its customers.
    function getTotalOutstanding(address bodega) external view returns (uint256);
}
