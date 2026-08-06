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
}
