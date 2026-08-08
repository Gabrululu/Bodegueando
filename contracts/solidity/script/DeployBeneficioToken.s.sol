// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {BeneficioToken, IBodegaRegistry} from "../src/BeneficioToken.sol";

/// @notice Deploys BeneficioToken against the already-deployed PaymentRouter (used purely as
/// a read-only IBodegaRegistry — same isBodega mapping every other contract trusts). Owner is
/// the deployer key, same as every other contract in this repo; see root README for the note
/// on transferring ownership to an operator's own smart account once known.
///
/// Usage:
///   PAYMENT_ROUTER_ADDRESS=... \
///   forge script script/DeployBeneficioToken.s.sol:DeployBeneficioToken \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployBeneficioToken is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address paymentRouterAddress = vm.envAddress("PAYMENT_ROUTER_ADDRESS");

        vm.startBroadcast(deployerKey);

        BeneficioToken token = new BeneficioToken(deployer, IBodegaRegistry(paymentRouterAddress));

        vm.stopBroadcast();

        console.log("BeneficioToken deployed at:", address(token));
        console.log("Owner (admin who can issue()):", deployer);
        console.log("Reading isBodega from PaymentRouter at:", paymentRouterAddress);
    }
}
