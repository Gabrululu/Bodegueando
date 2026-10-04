// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Shared base for every Bodegueando contract that moves money: they all settle in the
/// same USD stablecoin (Paxos USDG on Arbitrum), and they all hand amounts to PuntosToken /
/// FiadoScoring in one shared unit of account — "USD-wei", the stablecoin amount normalized to
/// 18 decimals (1e18 = 1 USD), whatever the stablecoin's own decimals are (USDG uses 6).
///
/// Amounts that stay inside a contract (invoice principal, group-order goal, loan principal...)
/// are kept in the stablecoin's own decimals, so they're exactly what gets transferred; only
/// what crosses into the PUNTOS/fiado ledger goes through `_toUsd18`.
abstract contract StablecoinSettlement {
    /// @notice The stablecoin this contract settles in. Immutable: switching asset would change
    /// the unit of every stored amount, so it warrants a new deployment.
    IERC20 public immutable stablecoin;

    /// @notice Multiplier from the stablecoin's smallest unit to USD-wei (1e12 for 6 decimals).
    uint256 public immutable stablecoinScale;

    error UnsupportedDecimals();

    constructor(IERC20 _stablecoin) {
        uint8 decimals = IERC20Metadata(address(_stablecoin)).decimals();
        if (decimals > 18) revert UnsupportedDecimals();
        stablecoin = _stablecoin;
        stablecoinScale = 10 ** (18 - uint256(decimals));
    }

    function _toUsd18(uint256 stablecoinAmount) internal view returns (uint256) {
        return stablecoinAmount * stablecoinScale;
    }
}
