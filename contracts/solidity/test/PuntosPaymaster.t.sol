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

    uint256 constant PUNTOS_PER_ETH = 2500 ether; // ETH at $2500

    function setUp() public {
        entryPoint = new EntryPoint();
        registry = new MockBodegaRegistry();

        vm.prank(owner);
        puntos = new PuntosToken(owner);

        paymaster = new PuntosPaymaster(
            IEntryPoint(address(entryPoint)), puntos, IBodegaRegistry(registry), owner, PUNTOS_PER_ETH
        );

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
        // Charged path now: no longer counts as a free transaction.
        _sponsoredRoundTrip(bodega, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        assertEq(paymaster.freeTransactionsUsed(bodega), paymaster.FREE_TRANSACTIONS());
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

    function _useFreeRunway() internal {
        for (uint256 i = 0; i < paymaster.FREE_TRANSACTIONS(); i++) {
            _sponsoredRoundTrip(account, 1 ether, 0.001 ether, IPaymaster.PostOpMode.opSucceeded);
        }
    }

    /// owed = (actualGasCost + POST_OP_OVERHEAD_GAS × fee) × $2500 — the test's postOp fee is 1 gwei.
    function _owed(uint256 actualGasCost) internal view returns (uint256) {
        return paymaster.gasCostInPuntos(actualGasCost + paymaster.POST_OP_OVERHEAD_GAS() * 1 gwei);
    }

    function test_AfterFreeRunOut_ValidationNeverGatesOnPuntos() public {
        _useFreeRunway();

        // No PUNTOS and no allowance at all: still accepted — paying never hits a gas wall.
        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertEq(validationData, 0);
    }

    function test_NoPuntos_PlatformCoversWholeCost() public {
        _useFreeRunway();

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);

        vm.expectEmit(true, false, false, true);
        emit PuntosPaymaster.GasShortfallSponsored(account, _owed(0.0003 ether));
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.0003 ether, 1 gwei);

        assertEq(puntos.balanceOf(address(paymaster)), 0);
    }

    function test_ChargesPuntosOnceFreeTransactionsAreUsed() public {
        _useFreeRunway();

        vm.prank(owner);
        puntos.mint(account, 10 ether);
        vm.prank(account);
        puntos.approve(address(paymaster), type(uint256).max);

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.0005 ether);

        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.0003 ether, 1 gwei);

        // (0.0003 ETH + 40k gas × 1 gwei) = 0.00034 ETH at $2500/ETH = 0.85 PUNTOS.
        assertEq(_owed(0.0003 ether), 0.85 ether);
        assertEq(puntos.balanceOf(account), 10 ether - 0.85 ether);
        assertEq(puntos.balanceOf(address(paymaster)), 0.85 ether);
    }

    function test_ChargeCappedByAllowance() public {
        _useFreeRunway();

        vm.prank(owner);
        puntos.mint(account, 10 ether);
        vm.prank(account);
        puntos.approve(address(paymaster), 0.1 ether);

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        vm.expectEmit(true, false, false, true);
        emit PuntosPaymaster.GasShortfallSponsored(account, _owed(0.0003 ether) - 0.1 ether);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.0003 ether, 1 gwei);

        assertEq(puntos.balanceOf(address(paymaster)), 0.1 ether, "never more than the allowance");
    }

    function test_ChargeCappedByBalance() public {
        _useFreeRunway();

        vm.prank(owner);
        puntos.mint(account, 0.2 ether);
        vm.prank(account);
        puntos.approve(address(paymaster), type(uint256).max);

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.0003 ether, 1 gwei);

        assertEq(puntos.balanceOf(account), 0, "charges everything it has, no revert");
        assertEq(puntos.balanceOf(address(paymaster)), 0.2 ether);
    }

    function testFuzz_ChargeNeverExceedsBalanceOrAllowance(uint256 balance, uint256 allowance, uint256 gasCost) public {
        balance = bound(balance, 0, 100 ether);
        allowance = bound(allowance, 0, 100 ether);
        gasCost = bound(gasCost, 0, 0.01 ether);
        _useFreeRunway();

        vm.prank(owner);
        puntos.mint(account, balance);
        vm.prank(account);
        puntos.approve(address(paymaster), allowance);

        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, gasCost, 1 gwei);

        uint256 charged = puntos.balanceOf(address(paymaster));
        assertLe(charged, balance);
        assertLe(charged, allowance);
        assertLe(charged, _owed(gasCost));
    }

    function test_GasCostInPuntos_UsesRate() public view {
        assertEq(paymaster.gasCostInPuntos(1 ether), PUNTOS_PER_ETH);
        assertEq(paymaster.gasCostInPuntos(0.0001 ether), 0.25 ether);
    }

    function test_SetPuntosPerEth_OnlyOwnerAndBounded() public {
        vm.prank(account);
        vm.expectRevert();
        paymaster.setPuntosPerEth(3000 ether);

        vm.startPrank(owner);
        paymaster.setPuntosPerEth(3000 ether);
        assertEq(paymaster.puntosPerEth(), 3000 ether);

        uint256 minRate = paymaster.MIN_PUNTOS_PER_ETH();
        uint256 maxRate = paymaster.MAX_PUNTOS_PER_ETH();
        vm.expectRevert(PuntosPaymaster.PuntosPerEthOutOfBounds.selector);
        paymaster.setPuntosPerEth(minRate - 1);
        vm.expectRevert(PuntosPaymaster.PuntosPerEthOutOfBounds.selector);
        paymaster.setPuntosPerEth(maxRate + 1);
        vm.stopPrank();
    }

    function test_RevertWhen_ConstructedWithOutOfBoundsRate() public {
        vm.expectRevert(PuntosPaymaster.PuntosPerEthOutOfBounds.selector);
        new PuntosPaymaster(IEntryPoint(address(entryPoint)), puntos, IBodegaRegistry(registry), owner, 1 ether);
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
}
