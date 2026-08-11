// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {GroupOrders, IBodegaRegistry} from "../src/GroupOrders.sol";

/// @notice Deploys GroupOrders against the already-deployed PaymentRouter (read-only
/// IBodegaRegistry, same isBodega mapping every other contract trusts). No wiring needed on
/// any other contract — GroupOrders only ever reads PaymentRouter and moves its own native
/// ETH balance, so neither PaymentRouter nor FiadoScoring needs to be told this one exists.
///
/// Usage:
///   PAYMENT_ROUTER_ADDRESS=... \
///   forge script script/DeployGroupOrders.s.sol:DeployGroupOrders \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployGroupOrders is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address paymentRouterAddress = vm.envAddress("PAYMENT_ROUTER_ADDRESS");

        vm.startBroadcast(deployerKey);

        GroupOrders groupOrders = new GroupOrders(deployer, IBodegaRegistry(paymentRouterAddress));

        vm.stopBroadcast();

        console.log("GroupOrders deployed at:", address(groupOrders));
        console.log("Reading isBodega from PaymentRouter at:", paymentRouterAddress);
    }
}
