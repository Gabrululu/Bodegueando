// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PuntosPaymaster} from "../src/PuntosPaymaster.sol";
import {EntryPoint} from "account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IPaymaster} from "account-abstraction/contracts/interfaces/IPaymaster.sol";

contract PuntosPaymasterTest is Test {
    EntryPoint entryPoint;
    PuntosToken puntos;
    PuntosPaymaster paymaster;

    address owner = makeAddr("owner");
    address account = makeAddr("smartAccount");

    function setUp() public {
        entryPoint = new EntryPoint();

        vm.prank(owner);
        puntos = new PuntosToken(owner);

        paymaster = new PuntosPaymaster(IEntryPoint(address(entryPoint)), puntos, owner);

        vm.prank(owner);
        puntos.setMinter(owner);
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

    function test_FirstUserOp_IsFreeRegardlessOfPuntosBalance() public {
        PackedUserOperation memory userOp = _emptyUserOp(account);

        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);

        assertEq(validationData, 0);
        assertFalse(paymaster.hasBootstrapped(account));

        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.001 ether, 1 gwei);

        assertTrue(paymaster.hasBootstrapped(account));
        assertEq(puntos.balanceOf(account), 0, "free bootstrap must not charge PUNTOS");
    }

    function test_SecondUserOp_RevertsWithoutAllowance() public {
        // Bootstrap first.
        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.startPrank(address(entryPoint));
        (bytes memory ctx,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, ctx, 0.001 ether, 1 gwei);
        vm.stopPrank();

        assertTrue(paymaster.hasBootstrapped(account));

        vm.prank(address(entryPoint));
        vm.expectRevert(PuntosPaymaster.InsufficientPuntosAllowance.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
    }

    function test_SecondUserOp_ChargesPuntosWhenApproved() public {
        // Bootstrap first.
        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.startPrank(address(entryPoint));
        (bytes memory ctx,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, ctx, 0.001 ether, 1 gwei);
        vm.stopPrank();

        // Give the account PUNTOS and have it approve the paymaster (this is what the
        // bootstrap UserOp batches in the real flow — see PuntosPaymaster.sol docs).
        vm.prank(owner);
        puntos.mint(account, 1 ether);
        vm.prank(account);
        puntos.approve(address(paymaster), type(uint256).max);

        vm.prank(address(entryPoint));
        (bytes memory context2,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.0005 ether);

        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context2, 0.0003 ether, 1 gwei);

        assertEq(puntos.balanceOf(account), 1 ether - 0.0003 ether);
        assertEq(puntos.balanceOf(address(paymaster)), 0.0003 ether);
    }

    function test_RevertWhen_InsufficientPuntosBalance() public {
        PackedUserOperation memory userOp = _emptyUserOp(account);
        vm.startPrank(address(entryPoint));
        (bytes memory ctx,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, ctx, 0.001 ether, 1 gwei);
        vm.stopPrank();

        // Approved, but never minted any PUNTOS.
        vm.prank(account);
        puntos.approve(address(paymaster), type(uint256).max);

        vm.prank(address(entryPoint));
        vm.expectRevert(PuntosPaymaster.InsufficientPuntosBalance.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.0005 ether);
    }
}
