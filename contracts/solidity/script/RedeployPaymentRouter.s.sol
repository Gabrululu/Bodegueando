// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IFiadoScoring} from "../src/interfaces/IFiadoScoring.sol";

/// @notice Deploys a NEW PaymentRouter against the ALREADY-DEPLOYED PuntosToken and
/// FiadoScoring, and relinks PuntosToken's minter to it. Does NOT touch PuntosToken or
/// FiadoScoring — unlike Deploy.s.sol, which deploys a fresh PuntosToken and would silently
/// zero out every tester's earned cashback balance. Use this for router-only changes (like
/// adding registerSelf) once PuntosToken/FiadoScoring are already live.
///
/// After running this, FiadoScoring.setPaymentRouter(newRouter) must still be called
/// separately (it's a Stylus contract, not wired through this Solidity script) — see root
/// README.
///
/// Usage (not run automatically — needs a funded testnet key):
///   forge script script/RedeployPaymentRouter.s.sol:RedeployPaymentRouter \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract RedeployPaymentRouter is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address puntosTokenAddress = vm.envAddress("PUNTOS_TOKEN_ADDRESS");
        address fiadoScoringAddress = vm.envAddress("FIADO_SCORING_ADDRESS");

        PuntosToken token = PuntosToken(puntosTokenAddress);

        vm.startBroadcast(deployerKey);

        PaymentRouter router = new PaymentRouter(deployer, token, IFiadoScoring(fiadoScoringAddress));
        token.setMinter(address(router));

        vm.stopBroadcast();

        console.log("New PaymentRouter deployed at:", address(router));
        console.log("PuntosToken minter relinked to it. Reused PuntosToken at:", puntosTokenAddress);
        console.log("Still needed: cast send", fiadoScoringAddress, "\"setPaymentRouter(address)\"", address(router));
    }
}
