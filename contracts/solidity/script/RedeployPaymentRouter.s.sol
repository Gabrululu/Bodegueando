// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {StablecoinScript} from "./StablecoinScript.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IFiadoScoring} from "../src/interfaces/IFiadoScoring.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
contract RedeployPaymentRouter is StablecoinScript {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address puntosTokenAddress = vm.envAddress("PUNTOS_TOKEN_ADDRESS");
        address fiadoScoringAddress = vm.envAddress("FIADO_SCORING_ADDRESS");
        address stablecoinAddress = address(_stablecoin());

        PuntosToken token = PuntosToken(puntosTokenAddress);

        vm.startBroadcast(deployerKey);

        PaymentRouter router =
            new PaymentRouter(deployer, token, IFiadoScoring(fiadoScoringAddress), IERC20(stablecoinAddress));
        token.setMinter(address(router));

        vm.stopBroadcast();

        console.log("New PaymentRouter deployed at:", address(router));
        console.log("Settles payments in stablecoin:", stablecoinAddress);
        console.log("PuntosToken minter relinked to it. Reused PuntosToken at:", puntosTokenAddress);
        console.log("Still needed: cast send", fiadoScoringAddress, "\"setPaymentRouter(address)\"", address(router));
    }
}
