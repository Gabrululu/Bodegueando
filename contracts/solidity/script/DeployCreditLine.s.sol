// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {StablecoinScript} from "./StablecoinScript.sol";
import {CreditLine, IBodegaRegistry, ICreditCertificate} from "../src/CreditLine.sol";

/// @notice Deploys CreditLine against the already-deployed PaymentRouter (read-only
/// IBodegaRegistry) and CreditCertificate. No wiring needed on either dependency — CreditLine
/// only ever reads them.
///
/// Usage:
///   PAYMENT_ROUTER_ADDRESS=... CREDIT_CERTIFICATE_ADDRESS=... \
///   forge script script/DeployCreditLine.s.sol:DeployCreditLine \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployCreditLine is StablecoinScript {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address paymentRouterAddress = vm.envAddress("PAYMENT_ROUTER_ADDRESS");
        address creditCertificateAddress = vm.envAddress("CREDIT_CERTIFICATE_ADDRESS");

        vm.startBroadcast(deployerKey);

        CreditLine creditLine = new CreditLine(
            deployer, IBodegaRegistry(paymentRouterAddress), ICreditCertificate(creditCertificateAddress), _stablecoin()
        );

        vm.stopBroadcast();

        console.log("CreditLine deployed at:", address(creditLine));
        console.log("Reading isBodega from PaymentRouter at:", paymentRouterAddress);
        console.log("Reading certificates from CreditCertificate at:", creditCertificateAddress);
    }
}
