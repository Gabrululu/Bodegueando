// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {InvoiceEscrow, IBodegaRegistry} from "../src/InvoiceEscrow.sol";
import {IFiadoScoring} from "../src/interfaces/IFiadoScoring.sol";

/// @notice Deploys InvoiceEscrow against the already-deployed PaymentRouter (read-only
/// IBodegaRegistry, same isBodega mapping every other contract trusts) and FiadoScoring.
/// Does NOT wire anything on FiadoScoring's side — `FiadoScoring.setEscrow(address)` must
/// still be called separately (it's a Stylus contract, not touched by this Solidity script)
/// before InvoiceEscrow's acceptInvoice/repayInvoice/claimCollateral will actually work.
///
/// Usage:
///   PAYMENT_ROUTER_ADDRESS=... FIADO_SCORING_ADDRESS=... \
///   forge script script/DeployInvoiceEscrow.s.sol:DeployInvoiceEscrow \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployInvoiceEscrow is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address paymentRouterAddress = vm.envAddress("PAYMENT_ROUTER_ADDRESS");
        address fiadoScoringAddress = vm.envAddress("FIADO_SCORING_ADDRESS");

        vm.startBroadcast(deployerKey);

        InvoiceEscrow escrow = new InvoiceEscrow(IBodegaRegistry(paymentRouterAddress), IFiadoScoring(fiadoScoringAddress));

        vm.stopBroadcast();

        console.log("InvoiceEscrow deployed at:", address(escrow));
        console.log("Reading isBodega from PaymentRouter at:", paymentRouterAddress);
        console.log("Still needed: cast send", fiadoScoringAddress, "\"setEscrow(address)\"", address(escrow));
    }
}
