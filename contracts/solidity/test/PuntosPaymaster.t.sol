// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PuntosPaymaster, IBodegaRegistry} from "../src/PuntosPaymaster.sol";
import {EntryPoint} from "account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IPaymaster} from "account-abstraction/contracts/interfaces/IPaymaster.sol";

/// @notice Minimal mock so tests control exactly which addresses count as a bodega, without
/// needing a real PaymentRouter deployment.
contract MockBodegaRegistry is IBodegaRegistry {
    mapping(address => bool) public isBodega;

    function setBodega(address account, bool value) external {
        isBodega[account] = value;
    }
}

contract PuntosPaymasterTest is Test {
    EntryPoint entryPoint;
    PuntosToken puntos;
    PuntosPaymaster paymaster;
    MockBodegaRegistry registry;

    address owner = makeAddr("owner");
    address account = makeAddr("smartAccount");
    address bodega = makeAddr("bodegaSmartAccount");

    function setUp() public {
        entryPoint = new EntryPoint();
        registry = new MockBodegaRegistry();

        vm.prank(owner);
        puntos = new PuntosToken(owner);

        paymaster = new PuntosPaymaster(IEntryPoint(address(entryPoint)), puntos, IBodegaRegistry(registry), owner);

        vm.prank(owner);
        puntos.setMinter(owner);

        registry.setBodega(bodega, true);
    }

    function _emptyUserOp(address sender) internal pure returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: ""
        });
    }

    function _sponsoredRoundTrip(address sender, uint256 maxCost, uint256 actualGasCost, IPaymaster.PostOpMode mode)
        internal
    {
        PackedUserOperation memory userOp = _emptyUserOp(sender);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCost);
        vm.prank(address(entryPoint));
        paymaster.postOp(mode, context, actualGasCost, 1 gwei);
    }

    // --- Bodegas: siempre patrocinadas, nunca cobran PUNTOS ---

    function test_Bodega_NeverChargedPuntos_EvenAfterFreeTransactionsWouldRunOut() public {
        // Una bodega no tiene PUNTOS ni approval — si dependiera del camino normal, cualquier
        // transacción más allá de FREE_TRANSACTIONS revertiría por falta de balance.
        for (uint256 i = 0; i < paymaster.FREE_TRANSACTIONS() + 3; i++) {
            _sponsoredRoundTrip(bodega, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }

        assertEq(puntos.balanceOf(bodega), 0, "bodega must never be charged PUNTOS for gas");
        assertEq(paymaster.freeTransactionsUsed(bodega), 0, "bodega path doesn't consume free-transaction runway");
    }

    function test_Bodega_ValidationNeverReverts_RegardlessOfBalance() public {
        PackedUserOperation memory userOp = _emptyUserOp(bodega);
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertEq(validationData, 0);
    }

    // --- Repuntar el registro de bodegas tras un redeploy de PaymentRouter ---

    function test_SetBodegaRegistry_RepointsWhoGetsSponsoredGas() public {
        MockBodegaRegistry newRegistry = new MockBodegaRegistry();
        newRegistry.setBodega(account, true); // "account" no era bodega en el registro viejo

        vm.prank(owner);
        paymaster.setBodegaRegistry(IBodegaRegistry(newRegistry));

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertEq(validationData, 0, "account is now recognized as a bodega under the new registry");

        // La bodega vieja ya no aparece en el registro nuevo (no se migró) — vuelve al
        // camino normal de compra/PUNTOS, no al de "siempre patrocinado".
        for (uint256 i = 0; i < paymaster.FREE_TRANSACTIONS(); i++) {
            _sponsoredRoundTrip(bodega, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }
        PackedUserOperation memory oldBodegaOp = _emptyUserOp(bodega);
        vm.prank(address(entryPoint));
        vm.expectRevert(PuntosPaymaster.InsufficientPuntosAllowance.selector);
        paymaster.validatePaymasterUserOp(oldBodegaOp, bytes32(0), 1 ether);
    }

    function test_OnlyOwnerCanSetBodegaRegistry() public {
        vm.prank(account);
        vm.expectRevert();
        paymaster.setBodegaRegistry(IBodegaRegistry(registry));
    }

    // --- Cuentas normales: FREE_TRANSACTIONS gratis, después se cobra en PUNTOS ---

    function test_FreeTransactions_AreFreeRegardlessOfPuntosBalance() public {
        uint256 free = paymaster.FREE_TRANSACTIONS();
        for (uint256 i = 0; i < free; i++) {
            assertEq(paymaster.freeTransactionsUsed(account), i);
            _sponsoredRoundTrip(account, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }
        assertEq(paymaster.freeTransactionsUsed(account), free);
        assertEq(puntos.balanceOf(account), 0, "free transactions must not charge PUNTOS");
    }

    function test_TransactionAfterFreeRunOut_RevertsWithoutAllowance() public {
        uint256 free = paymaster.FREE_TRANSACTIONS();
        for (uint256 i = 0; i < free; i++) {
            _sponsoredRoundTrip(account, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        vm.expectRevert(PuntosPaymaster.InsufficientPuntosAllowance.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
    }

    function test_ChargesPuntosOnceFreeTransactionsAreUsed() public {
        uint256 free = paymaster.FREE_TRANSACTIONS();
        for (uint256 i = 0; i < free; i++) {
            _sponsoredRoundTrip(account, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }

        vm.prank(owner);
        puntos.mint(account, 1 ether);
        vm.prank(account);
        puntos.approve(address(paymaster), type(uint256).max);

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.0005 ether);

        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.0003 ether, 1 gwei);

        assertEq(puntos.balanceOf(account), 1 ether - 0.0003 ether);
        assertEq(puntos.balanceOf(address(paymaster)), 0.0003 ether);
    }

    function test_FailedFreeTransaction_DoesNotConsumeRunway() public {
        PackedUserOperation memory userOp = _emptyUserOp(account);

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);

        // The account's own call reverted (e.g. wrong bodega code) — opReverted, not
        // opSucceeded. This must NOT count against the free-transaction runway.
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opReverted, context, 0.001 ether, 1 gwei);

        assertEq(paymaster.freeTransactionsUsed(account), 0, "a reverted UserOp must not burn free runway");

        // The account still has all its free transactions for when it actually succeeds.
        _sponsoredRoundTrip(account, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        assertEq(paymaster.freeTransactionsUsed(account), 1);
    }

    function test_RevertWhen_InsufficientPuntosBalance() public {
        uint256 free = paymaster.FREE_TRANSACTIONS();
        for (uint256 i = 0; i < free; i++) {
            _sponsoredRoundTrip(account, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }

        // Approved, but never minted any PUNTOS.
        vm.prank(account);
        puntos.approve(address(paymaster), type(uint256).max);

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        vm.expectRevert(PuntosPaymaster.InsufficientPuntosBalance.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.0005 ether);
    }
}
