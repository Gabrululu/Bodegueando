// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IFiadoScoring} from "../src/interfaces/IFiadoScoring.sol";

/// @notice Deploys PuntosToken + PaymentRouter to Arbitrum Sepolia and wires them together.
/// The FiadoScoring (Stylus) contract must be deployed separately via `cargo stylus deploy`
/// (see contracts/stylus-fiado-scoring/README or the repo root README) — its address is passed
/// in as FIADO_SCORING_ADDRESS.
///
/// Usage (not run automatically — needs a funded testnet key):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address fiadoScoringAddress = vm.envAddress("FIADO_SCORING_ADDRESS");

        vm.startBroadcast(deployerKey);

        PuntosToken token = new PuntosToken(deployer);
        PaymentRouter router = new PaymentRouter(deployer, token, IFiadoScoring(fiadoScoringAddress));
        token.setMinter(address(router));

        vm.stopBroadcast();

        console.log("PuntosToken deployed at:", address(token));
        console.log("PaymentRouter deployed at:", address(router));
        console.log("Wired to FiadoScoring at:", fiadoScoringAddress);
    }
}
