// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {StablecoinScript} from "./StablecoinScript.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {PuntosPaymaster, IBodegaRegistry as IPaymasterRegistry} from "../src/PuntosPaymaster.sol";
import {InvoiceEscrow, IBodegaRegistry as IEscrowRegistry} from "../src/InvoiceEscrow.sol";
import {GroupOrders, IBodegaRegistry as IGroupOrdersRegistry} from "../src/GroupOrders.sol";
import {CreditLine, IBodegaRegistry as ICreditLineRegistry, ICreditCertificate} from "../src/CreditLine.sol";
import {IFiadoScoring} from "../src/interfaces/IFiadoScoring.sol";

/// @notice Contracts that already exist and only need to learn the new bodega registry.
interface IRepointable {
    function owner() external view returns (address);
    function setBodegaRegistry(address registry) external;
}

/// @notice Deploys every contract that moves money, all settling in USDG, and wires the
/// Solidity side together in one broadcast:
///   PaymentRouter -> PuntosToken minter
///   PuntosPaymaster (+ ETH deposit in the EntryPoint)
///   InvoiceEscrow, GroupOrders, CreditLine
///   RewardsCatalog / BeneficioToken (already deployed) repointed to the new router, when the
///   deployer still owns them.
///
/// FiadoScoring is reused, not redeployed: new Stylus activations are paused on Arbitrum
/// (One, Nova and Sepolia) since 2026-10-02, and its scoring is unit-agnostic anyway.
///
/// This script never CALLS FiadoScoring: forge executes scripts in its own EVM, which can't run
/// Stylus (WASM) code, so any call to it reverts during simulation ("OpcodeNotFound"). Only its
/// address is stored (PaymentRouter/InvoiceEscrow constructors don't call it). Its two setters —
/// `setPaymentRouter(router)` and `setEscrow(escrow)` — are sent afterwards with `cast send`,
/// which estimates gas on the Arbitrum node itself. `script/deploy-usdg-stack.sh` checks
/// ownership on-chain and runs both steps in order.
///
/// OLD_PAYMASTER_ADDRESS (optional): the previous PuntosPaymaster, owned by the deployer. Its
/// whole EntryPoint deposit is withdrawn to the deployer before funding the new one, so the
/// ETH isn't stranded.
///
/// Usage (prefer the wrapper script):
///   FIADO_SCORING_ADDRESS=... PUNTOS_TOKEN_ADDRESS=... CREDIT_CERTIFICATE_ADDRESS=... \
///   [REWARDS_CATALOG_ADDRESS=...] [BENEFICIO_TOKEN_ADDRESS=...] \
///   [OLD_PAYMASTER_ADDRESS=...] [PUNTOS_PER_ETH=2500e18] [PAYMASTER_DEPOSIT_ETH=0.02e18] \
///   [STABLECOIN_ADDRESS=...] \
///   forge script script/DeployUsdgStack.s.sol:DeployUsdgStack \
///     --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
contract DeployUsdgStack is StablecoinScript {
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    struct Deployed {
        PaymentRouter router;
        PuntosPaymaster paymaster;
        InvoiceEscrow escrow;
        GroupOrders groupOrders;
        CreditLine creditLine;
    }

    function run() external returns (Deployed memory d) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        IERC20 stablecoin = _stablecoin();
        address fiadoScoring = vm.envAddress("FIADO_SCORING_ADDRESS");
        PuntosToken puntos = PuntosToken(vm.envAddress("PUNTOS_TOKEN_ADDRESS"));
        address creditCertificate = vm.envAddress("CREDIT_CERTIFICATE_ADDRESS");
        address rewardsCatalog = vm.envOr("REWARDS_CATALOG_ADDRESS", address(0));
        address beneficioToken = vm.envOr("BENEFICIO_TOKEN_ADDRESS", address(0));
        uint256 puntosPerEth = vm.envOr("PUNTOS_PER_ETH", uint256(2500 ether));
        uint256 paymasterDeposit = vm.envOr("PAYMASTER_DEPOSIT_ETH", uint256(0.02 ether));
        address oldPaymaster = vm.envOr("OLD_PAYMASTER_ADDRESS", address(0));

        require(puntos.owner() == deployer, "deployer must own PuntosToken");

        vm.startBroadcast(deployerKey);

        if (oldPaymaster != address(0)) {
            uint256 oldDeposit = PuntosPaymaster(oldPaymaster).getDeposit();
            if (oldDeposit > 0) PuntosPaymaster(oldPaymaster).withdrawTo(payable(deployer), oldDeposit);
        }

        d.router = new PaymentRouter(deployer, puntos, IFiadoScoring(fiadoScoring), stablecoin);
        puntos.setMinter(address(d.router));

        d.paymaster = new PuntosPaymaster(
            IEntryPoint(ENTRY_POINT_V07), puntos, IPaymasterRegistry(address(d.router)), deployer, puntosPerEth
        );
        if (paymasterDeposit > 0) d.paymaster.deposit{value: paymasterDeposit}();

        d.escrow =
            new InvoiceEscrow(deployer, IEscrowRegistry(address(d.router)), IFiadoScoring(fiadoScoring), stablecoin);

        d.groupOrders = new GroupOrders(deployer, IGroupOrdersRegistry(address(d.router)), stablecoin);
        d.creditLine = new CreditLine(
            deployer, ICreditLineRegistry(address(d.router)), ICreditCertificate(creditCertificate), stablecoin
        );

        _repoint(rewardsCatalog, address(d.router), deployer, "RewardsCatalog");
        _repoint(beneficioToken, address(d.router), deployer, "BeneficioToken");

        vm.stopBroadcast();

        console.log("Stablecoin:", address(stablecoin));
        console.log("NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=", address(d.router));
        console.log("NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS=", address(d.paymaster));
        console.log("NEXT_PUBLIC_INVOICE_ESCROW_ADDRESS=", address(d.escrow));
        console.log("NEXT_PUBLIC_GROUP_ORDERS_ADDRESS=", address(d.groupOrders));
        console.log("NEXT_PUBLIC_CREDIT_LINE_ADDRESS=", address(d.creditLine));
        console.log("NEXT_PUBLIC_FIADO_SCORING_ADDRESS=", fiadoScoring);
        console.log("Still needed on FiadoScoring (Stylus), via cast send:");
        console.log("  setPaymentRouter(address)", address(d.router));
        console.log("  setEscrow(address)", address(d.escrow));
    }

    function _repoint(address target, address router, address deployer, string memory name) internal {
        if (target == address(0)) return;
        if (IRepointable(target).owner() != deployer) {
            console.log(name, "is owned by another account; repoint it manually with setBodegaRegistry:", target);
            return;
        }
        IRepointable(target).setBodegaRegistry(router);
    }
}
