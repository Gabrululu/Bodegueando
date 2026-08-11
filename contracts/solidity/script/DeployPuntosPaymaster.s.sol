// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PuntosPaymaster, IBodegaRegistry} from "../src/PuntosPaymaster.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys PuntosPaymaster against the canonical EntryPoint v0.7 (same singleton
/// address on every EVM chain, already confirmed deployed on Arbitrum Sepolia), the
/// already-deployed PuntosToken and PaymentRouter (used read-only, as the bodega registry
/// that decides who gets unconditionally sponsored gas), then deposits an initial ETH stake
/// so it can start sponsoring UserOperations right away.
///
/// Usage:
///   PUNTOS_TOKEN_ADDRESS=... PAYMENT_ROUTER_ADDRESS=... DEPOSIT_ETH=0.02 \
///   forge script script/DeployPuntosPaymaster.s.sol:DeployPuntosPaymaster \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployPuntosPaymaster is Script {
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address puntosTokenAddress = vm.envAddress("PUNTOS_TOKEN_ADDRESS");
        address paymentRouterAddress = vm.envAddress("PAYMENT_ROUTER_ADDRESS");
        uint256 depositEth = vm.envOr("DEPOSIT_ETH", uint256(0.02 ether));

        vm.startBroadcast(deployerKey);

        PuntosPaymaster paymaster = new PuntosPaymaster(
            IEntryPoint(ENTRY_POINT_V07), IERC20(puntosTokenAddress), IBodegaRegistry(paymentRouterAddress), deployer
        );
        paymaster.deposit{value: depositEth}();

        vm.stopBroadcast();

        console.log("PuntosPaymaster deployed at:", address(paymaster));
        console.log("Deposited into EntryPoint:", depositEth);
    }
}
