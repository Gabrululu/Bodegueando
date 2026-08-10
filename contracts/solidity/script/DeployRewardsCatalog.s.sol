// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RewardsCatalog, IBodegaRegistry} from "../src/RewardsCatalog.sol";

/// @notice Deploys RewardsCatalog against the already-deployed PaymentRouter (read-only
/// IBodegaRegistry, same isBodega mapping every other contract trusts) and PuntosToken. No
/// wiring needed on either dependency — unlike InvoiceEscrow, RewardsCatalog only ever reads
/// PaymentRouter and calls PuntosToken's already-public transferFrom, so neither contract
/// needs to be told this one exists.
///
/// Usage:
///   PAYMENT_ROUTER_ADDRESS=... PUNTOS_TOKEN_ADDRESS=... \
///   forge script script/DeployRewardsCatalog.s.sol:DeployRewardsCatalog \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployRewardsCatalog is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address paymentRouterAddress = vm.envAddress("PAYMENT_ROUTER_ADDRESS");
        address puntosTokenAddress = vm.envAddress("PUNTOS_TOKEN_ADDRESS");

        vm.startBroadcast(deployerKey);

        RewardsCatalog catalog = new RewardsCatalog(IBodegaRegistry(paymentRouterAddress), IERC20(puntosTokenAddress));

        vm.stopBroadcast();

        console.log("RewardsCatalog deployed at:", address(catalog));
        console.log("Reading isBodega from PaymentRouter at:", paymentRouterAddress);
        console.log("Spending PUNTOS at:", puntosTokenAddress);
    }
}
