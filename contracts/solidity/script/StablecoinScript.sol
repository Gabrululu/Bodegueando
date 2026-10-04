// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Base for deploy scripts of contracts that settle in the app's stablecoin. Defaults
/// to Paxos USDG on Arbitrum Sepolia (docs.paxos.com/guides/stablecoin/usdg/testnet); set
/// STABLECOIN_ADDRESS to override — on Arbitrum One USDG is
/// 0x004B506865409877C9fA29bfb1ebA929984B9bbC. Every contract of one deployment must use the
/// same stablecoin, since they share FiadoScoring's unit of account.
abstract contract StablecoinScript is Script {
    address internal constant USDG_ARBITRUM_SEPOLIA = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;

    function _stablecoin() internal view returns (IERC20) {
        return IERC20(vm.envOr("STABLECOIN_ADDRESS", USDG_ARBITRUM_SEPOLIA));
    }
}
