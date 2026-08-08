// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BeneficioToken, IBodegaRegistry} from "../src/BeneficioToken.sol";

/// @notice Test double standing in for PaymentRouter's isBodega registry — just a settable
/// mapping, so BeneficioToken can be tested without deploying the whole payments stack.
contract MockBodegaRegistry is IBodegaRegistry {
    mapping(address => bool) public isBodega;

    function setBodega(address account, bool value) external {
        isBodega[account] = value;
    }
}

contract BeneficioTokenTest is Test {
    BeneficioToken token;
    MockBodegaRegistry registry;

    address owner = makeAddr("owner");
    address beneficiary = makeAddr("beneficiary");
    address bodega = makeAddr("bodega");
    address randomWallet = makeAddr("randomWallet");

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(bodega, true);

        vm.prank(owner);
        token = new BeneficioToken(owner, registry);
    }

    function test_OnlyOwnerCanIssue() public {
        vm.prank(randomWallet);
        vm.expectRevert();
        token.issue(beneficiary, 100, 30 days);

        vm.prank(owner);
        token.issue(beneficiary, 100, 30 days);
        assertEq(token.balanceOf(beneficiary), 100);
    }

    function test_IssueSetsExpiry() public {
        vm.warp(1_000_000);
        vm.prank(owner);
        token.issue(beneficiary, 100, 30 days);
        assertEq(token.expiresAt(beneficiary), 1_000_000 + 30 days);
    }

    function test_RedeemToRegisteredBodegaSucceeds() public {
        vm.prank(owner);
        token.issue(beneficiary, 100, 30 days);

        vm.prank(beneficiary);
        vm.expectEmit(true, true, false, true);
        emit BeneficioToken.BenefitRedeemed(beneficiary, bodega, 40);
        token.transfer(bodega, 40);

        assertEq(token.balanceOf(bodega), 40);
        assertEq(token.balanceOf(beneficiary), 60);
    }

    function test_RevertWhen_TransferToNonBodega() public {
        vm.prank(owner);
        token.issue(beneficiary, 100, 30 days);

        vm.prank(beneficiary);
        vm.expectRevert(BeneficioToken.NotABodega.selector);
        token.transfer(randomWallet, 40);
    }

    function test_RevertWhen_BeneficiaryTriesToResellToAnotherBeneficiary() public {
        // The whole point of the restriction: it can't become an informal cash-like transfer
        // between two people, only spent at a real bodega.
        vm.prank(owner);
        token.issue(beneficiary, 100, 30 days);

        address anotherPerson = makeAddr("anotherPerson");
        vm.prank(beneficiary);
        vm.expectRevert(BeneficioToken.NotABodega.selector);
        token.transfer(anotherPerson, 40);
    }

    function test_RevertWhen_TransferAfterExpiry() public {
        vm.warp(1_000_000);
        vm.prank(owner);
        token.issue(beneficiary, 100, 1 days);

        vm.warp(1_000_000 + 1 days + 1);
        vm.prank(beneficiary);
        vm.expectRevert(BeneficioToken.BenefitExpired.selector);
        token.transfer(bodega, 40);
    }

    function test_TransferFromAlsoEnforcesBodegaRestriction() public {
        vm.prank(owner);
        token.issue(beneficiary, 100, 30 days);

        vm.prank(beneficiary);
        token.approve(randomWallet, 40);

        vm.prank(randomWallet);
        vm.expectRevert(BeneficioToken.NotABodega.selector);
        token.transferFrom(beneficiary, randomWallet, 40);

        vm.prank(randomWallet);
        token.transferFrom(beneficiary, bodega, 40);
        assertEq(token.balanceOf(bodega), 40);
    }

    function test_RevertWhen_IssuingToZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(BeneficioToken.ZeroAddress.selector);
        token.issue(address(0), 100, 30 days);
    }

    function test_OnlyOwnerCanUpdateBodegaRegistry() public {
        MockBodegaRegistry newRegistry = new MockBodegaRegistry();

        vm.prank(randomWallet);
        vm.expectRevert();
        token.setBodegaRegistry(newRegistry);

        vm.prank(owner);
        token.setBodegaRegistry(newRegistry);
        assertEq(address(token.bodegaRegistry()), address(newRegistry));
    }
}
