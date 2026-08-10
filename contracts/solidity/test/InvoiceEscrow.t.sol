// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {InvoiceEscrow, IBodegaRegistry} from "../src/InvoiceEscrow.sol";
import {MockFiadoScoring} from "./mocks/MockFiadoScoring.sol";

/// @notice Test double standing in for PaymentRouter's isBodega registry — same pattern as
/// BeneficioToken.t.sol's MockBodegaRegistry.
contract MockBodegaRegistry is IBodegaRegistry {
    mapping(address => bool) public isBodega;

    function setBodega(address account, bool value) external {
        isBodega[account] = value;
    }
}

contract InvoiceEscrowTest is Test {
    InvoiceEscrow escrow;
    MockBodegaRegistry registry;
    MockFiadoScoring fiadoScoring;

    address bodega = makeAddr("bodega");
    address customer = makeAddr("customer");
    address randomWallet = makeAddr("randomWallet");

    uint256 constant PRINCIPAL = 1 ether;
    uint256 constant COLLATERAL = 0.3 ether;

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(bodega, true);

        fiadoScoring = new MockFiadoScoring();

        escrow = new InvoiceEscrow(registry, fiadoScoring);
        fiadoScoring.setEscrow(address(escrow));

        vm.deal(customer, 10 ether);
        vm.deal(bodega, 10 ether);
    }

    function _propose() internal returns (uint256 id) {
        vm.prank(bodega);
        id = escrow.proposeInvoice(customer, PRINCIPAL, COLLATERAL, uint64(block.timestamp + 7 days));
    }

    function test_OnlyRegisteredBodegaCanPropose() public {
        vm.prank(randomWallet);
        vm.expectRevert(InvoiceEscrow.NotABodega.selector);
        escrow.proposeInvoice(customer, PRINCIPAL, COLLATERAL, uint64(block.timestamp + 7 days));
    }

    function test_RevertWhen_ProposingZeroPrincipal() public {
        vm.prank(bodega);
        vm.expectRevert(InvoiceEscrow.ZeroAmount.selector);
        escrow.proposeInvoice(customer, 0, COLLATERAL, uint64(block.timestamp + 7 days));
    }

    function test_RevertWhen_ProposingPastDueDate() public {
        vm.warp(1_000_000);
        vm.prank(bodega);
        vm.expectRevert(InvoiceEscrow.InvalidDueDate.selector);
        escrow.proposeInvoice(customer, PRINCIPAL, COLLATERAL, uint64(block.timestamp));
    }

    function test_ProposeThenCancel() public {
        uint256 id = _propose();

        vm.prank(randomWallet);
        vm.expectRevert(InvoiceEscrow.NotInvoiceBodega.selector);
        escrow.cancelProposal(id);

        vm.prank(bodega);
        escrow.cancelProposal(id);

        vm.prank(customer);
        vm.expectRevert(InvoiceEscrow.InvalidState.selector);
        escrow.acceptInvoice{value: COLLATERAL}(id);
    }

    function test_AcceptInvoiceRequiresExactCollateralAndRecordsDebt() public {
        uint256 id = _propose();

        vm.prank(customer);
        vm.expectRevert(InvoiceEscrow.WrongCollateralAmount.selector);
        escrow.acceptInvoice{value: COLLATERAL - 1}(id);

        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);

        (,,,,,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Active));
        assertEq(address(escrow).balance, COLLATERAL);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), PRINCIPAL);
    }

    function test_RevertWhen_AcceptingAlreadyActiveInvoice() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);

        vm.prank(customer);
        vm.expectRevert(InvoiceEscrow.InvalidState.selector);
        escrow.acceptInvoice{value: COLLATERAL}(id);
    }

    function test_RevertWhen_NonCustomerAccepts() public {
        uint256 id = _propose();
        vm.deal(randomWallet, 1 ether);
        vm.prank(randomWallet);
        vm.expectRevert(InvoiceEscrow.NotInvoiceCustomer.selector);
        escrow.acceptInvoice{value: COLLATERAL}(id);
    }

    function test_PartialRepaymentDoesNotReleaseCollateral() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);

        uint256 customerBalanceBefore = customer.balance;
        vm.prank(customer);
        escrow.repayInvoice{value: PRINCIPAL / 2}(id);

        (,,, uint256 collateral, uint256 repaidAmount,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(repaidAmount, PRINCIPAL / 2);
        assertEq(collateral, COLLATERAL, "collateral must still be held");
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Active));
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), PRINCIPAL - PRINCIPAL / 2);
        assertEq(customer.balance, customerBalanceBefore - PRINCIPAL / 2, "no refund expected on exact partial payment");
    }

    function test_FullRepaymentReleasesCollateralAndOverpaymentRefunds() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);

        uint256 customerBalanceBefore = customer.balance;
        uint256 bodegaBalanceBefore = bodega.balance;

        // Overpay by 0.1 ether — should be refunded, only PRINCIPAL applied.
        vm.prank(customer);
        escrow.repayInvoice{value: PRINCIPAL + 0.1 ether}(id);

        (,,, uint256 collateral, uint256 repaidAmount,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(repaidAmount, PRINCIPAL);
        assertEq(collateral, 0, "collateral must be released");
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Repaid));
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), 0);
        assertEq(bodega.balance, bodegaBalanceBefore + PRINCIPAL);
        // Customer paid PRINCIPAL net, but got the collateral back.
        assertEq(customer.balance, customerBalanceBefore - PRINCIPAL + COLLATERAL);
    }

    function test_RevertWhen_ClaimingBeforeDueDate() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);

        vm.prank(bodega);
        vm.expectRevert(InvoiceEscrow.NotYetDue.selector);
        escrow.claimCollateral(id);
    }

    function test_RevertWhen_NonBodegaClaims() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);
        vm.warp(block.timestamp + 8 days);

        vm.prank(randomWallet);
        vm.expectRevert(InvoiceEscrow.NotInvoiceBodega.selector);
        escrow.claimCollateral(id);
    }

    function test_ClaimAfterDueDateTransfersShortfallAndRefundsRest() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);

        // Customer repays part of it before defaulting on the rest.
        vm.prank(customer);
        escrow.repayInvoice{value: 0.8 ether}(id);
        // Outstanding shortfall is PRINCIPAL - 0.8 ether = 0.2 ether, less than COLLATERAL (0.3 ether).

        vm.warp(block.timestamp + 8 days);

        uint256 bodegaBalanceBefore = bodega.balance;
        uint256 customerBalanceBefore = customer.balance;

        vm.prank(bodega);
        escrow.claimCollateral(id);

        uint256 expectedClaim = 0.2 ether;
        uint256 expectedRefund = COLLATERAL - expectedClaim;

        (,,, uint256 collateral,,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(collateral, 0);
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Defaulted));
        assertEq(bodega.balance, bodegaBalanceBefore + expectedClaim);
        assertEq(customer.balance, customerBalanceBefore + expectedRefund);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), 0);
    }

    function test_ClaimCapsAtCollateralWhenShortfallExceedsIt() public {
        // Collateral smaller than principal, customer repays nothing at all.
        vm.prank(bodega);
        uint256 id = escrow.proposeInvoice(customer, 1 ether, 0.1 ether, uint64(block.timestamp + 1 days));
        vm.prank(customer);
        escrow.acceptInvoice{value: 0.1 ether}(id);

        vm.warp(block.timestamp + 2 days);

        uint256 bodegaBalanceBefore = bodega.balance;
        vm.prank(bodega);
        escrow.claimCollateral(id);

        // Shortfall is the full 1 ether, but only 0.1 ether collateral exists to claim.
        assertEq(bodega.balance, bodegaBalanceBefore + 0.1 ether);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), 1 ether - 0.1 ether, "remaining debt stays on the ledger");
    }

    function test_RevertWhen_ClaimingAlreadyResolvedInvoice() public {
        uint256 id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice{value: COLLATERAL}(id);
        vm.prank(customer);
        escrow.repayInvoice{value: PRINCIPAL}(id);

        vm.warp(block.timestamp + 8 days);
        vm.prank(bodega);
        vm.expectRevert(InvoiceEscrow.InvalidState.selector);
        escrow.claimCollateral(id);
    }
}
