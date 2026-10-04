// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InvoiceEscrow, IBodegaRegistry} from "../src/InvoiceEscrow.sol";
import {MockFiadoScoring} from "./mocks/MockFiadoScoring.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

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
    MockUSDG usdg;

    address owner = makeAddr("owner");
    address bodega = makeAddr("bodega");
    address customer = makeAddr("customer");
    address randomWallet = makeAddr("randomWallet");

    // Stablecoin amounts (USDG, 6 decimals). FiadoScoring sees them as USD-wei (x 1e12).
    uint256 constant PRINCIPAL = 100e6;
    uint256 constant COLLATERAL = 30e6;
    uint256 constant SCALE = 1e12;

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(bodega, true);

        fiadoScoring = new MockFiadoScoring();
        usdg = new MockUSDG();

        escrow = new InvoiceEscrow(owner, registry, fiadoScoring, IERC20(address(usdg)));
        fiadoScoring.setEscrow(address(escrow));

        usdg.mint(customer, 1_000e6);
        vm.prank(customer);
        usdg.approve(address(escrow), type(uint256).max);
    }

    function _propose() internal returns (uint256 id) {
        vm.prank(bodega);
        id = escrow.proposeInvoice(customer, PRINCIPAL, COLLATERAL, uint64(block.timestamp + 7 days));
    }

    function _proposeAndAccept() internal returns (uint256 id) {
        id = _propose();
        vm.prank(customer);
        escrow.acceptInvoice(id);
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
        escrow.acceptInvoice(id);
    }

    function test_AcceptInvoicePullsCollateralAndRecordsDebtInUsd18() public {
        uint256 id = _proposeAndAccept();

        (,,,,,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Active));
        assertEq(usdg.balanceOf(address(escrow)), COLLATERAL);
        assertEq(usdg.balanceOf(customer), 1_000e6 - COLLATERAL);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), PRINCIPAL * SCALE);
    }

    function test_AcceptInvoiceWithZeroCollateral() public {
        vm.prank(bodega);
        uint256 id = escrow.proposeInvoice(customer, PRINCIPAL, 0, uint64(block.timestamp + 7 days));
        vm.prank(customer);
        escrow.acceptInvoice(id);

        assertEq(usdg.balanceOf(address(escrow)), 0);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), PRINCIPAL * SCALE);
    }

    function test_RevertWhen_AcceptingWithoutApproval() public {
        uint256 id = _propose();
        vm.prank(customer);
        usdg.approve(address(escrow), 0);

        vm.prank(customer);
        vm.expectRevert();
        escrow.acceptInvoice(id);
    }

    function test_RevertWhen_AcceptingAlreadyActiveInvoice() public {
        uint256 id = _proposeAndAccept();

        vm.prank(customer);
        vm.expectRevert(InvoiceEscrow.InvalidState.selector);
        escrow.acceptInvoice(id);
    }

    function test_RevertWhen_NonCustomerAccepts() public {
        uint256 id = _propose();
        vm.prank(randomWallet);
        vm.expectRevert(InvoiceEscrow.NotInvoiceCustomer.selector);
        escrow.acceptInvoice(id);
    }

    function test_PartialRepaymentDoesNotReleaseCollateral() public {
        uint256 id = _proposeAndAccept();

        uint256 customerBalanceBefore = usdg.balanceOf(customer);
        vm.prank(customer);
        escrow.repayInvoice(id, PRINCIPAL / 2);

        (,,, uint256 collateral, uint256 repaidAmount,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(repaidAmount, PRINCIPAL / 2);
        assertEq(collateral, COLLATERAL, "collateral must still be held");
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Active));
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), (PRINCIPAL - PRINCIPAL / 2) * SCALE);
        assertEq(usdg.balanceOf(customer), customerBalanceBefore - PRINCIPAL / 2);
        assertEq(usdg.balanceOf(bodega), PRINCIPAL / 2, "repayment goes straight to the bodega");
    }

    function test_FullRepaymentReleasesCollateralAndNeverPullsOverpayment() public {
        uint256 id = _proposeAndAccept();

        uint256 customerBalanceBefore = usdg.balanceOf(customer);

        // Ask to pay 10 USDG more than owed — only PRINCIPAL is pulled.
        vm.prank(customer);
        escrow.repayInvoice(id, PRINCIPAL + 10e6);

        (,,, uint256 collateral, uint256 repaidAmount,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(repaidAmount, PRINCIPAL);
        assertEq(collateral, 0, "collateral must be released");
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Repaid));
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), 0);
        assertEq(usdg.balanceOf(bodega), PRINCIPAL);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        // Customer paid PRINCIPAL net, but got the collateral back.
        assertEq(usdg.balanceOf(customer), customerBalanceBefore - PRINCIPAL + COLLATERAL);
    }

    function test_RevertWhen_RepayingZero() public {
        uint256 id = _proposeAndAccept();
        vm.prank(customer);
        vm.expectRevert(InvoiceEscrow.ZeroAmount.selector);
        escrow.repayInvoice(id, 0);
    }

    function test_RevertWhen_ClaimingBeforeDueDate() public {
        uint256 id = _proposeAndAccept();

        vm.prank(bodega);
        vm.expectRevert(InvoiceEscrow.NotYetDue.selector);
        escrow.claimCollateral(id);
    }

    function test_RevertWhen_NonBodegaClaims() public {
        uint256 id = _proposeAndAccept();
        vm.warp(block.timestamp + 8 days);

        vm.prank(randomWallet);
        vm.expectRevert(InvoiceEscrow.NotInvoiceBodega.selector);
        escrow.claimCollateral(id);
    }

    function test_ClaimAfterDueDateTransfersShortfallAndRefundsRest() public {
        uint256 id = _proposeAndAccept();

        // Customer repays part of it before defaulting on the rest.
        vm.prank(customer);
        escrow.repayInvoice(id, 80e6);
        // Outstanding shortfall is 20 USDG, less than COLLATERAL (30 USDG).

        vm.warp(block.timestamp + 8 days);

        uint256 bodegaBalanceBefore = usdg.balanceOf(bodega);
        uint256 customerBalanceBefore = usdg.balanceOf(customer);

        vm.prank(bodega);
        escrow.claimCollateral(id);

        uint256 expectedClaim = 20e6;
        uint256 expectedRefund = COLLATERAL - expectedClaim;

        (,,, uint256 collateral,,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(collateral, 0);
        assertEq(uint8(status), uint8(InvoiceEscrow.Status.Defaulted));
        assertEq(usdg.balanceOf(bodega), bodegaBalanceBefore + expectedClaim);
        assertEq(usdg.balanceOf(customer), customerBalanceBefore + expectedRefund);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), 0);
    }

    function test_ClaimCapsAtCollateralWhenShortfallExceedsIt() public {
        // Collateral smaller than principal, customer repays nothing at all.
        vm.prank(bodega);
        uint256 id = escrow.proposeInvoice(customer, 100e6, 10e6, uint64(block.timestamp + 1 days));
        vm.prank(customer);
        escrow.acceptInvoice(id);

        vm.warp(block.timestamp + 2 days);

        vm.prank(bodega);
        escrow.claimCollateral(id);

        // Shortfall is the full 100 USDG, but only 10 USDG collateral exists to claim.
        assertEq(usdg.balanceOf(bodega), 10e6);
        assertEq(fiadoScoring.fiadoDebt(bodega, customer), 90e6 * SCALE, "remaining debt stays on the ledger");
    }

    function test_RevertWhen_ClaimingAlreadyResolvedInvoice() public {
        uint256 id = _proposeAndAccept();
        vm.prank(customer);
        escrow.repayInvoice(id, PRINCIPAL);

        vm.warp(block.timestamp + 8 days);
        vm.prank(bodega);
        vm.expectRevert(InvoiceEscrow.InvalidState.selector);
        escrow.claimCollateral(id);
    }

    function testFuzz_EscrowNeverHoldsMoreThanActiveCollateral(uint256 repay1, uint256 repay2) public {
        uint256 id = _proposeAndAccept();
        repay1 = bound(repay1, 1, PRINCIPAL * 2);
        repay2 = bound(repay2, 1, PRINCIPAL * 2);

        vm.prank(customer);
        escrow.repayInvoice(id, repay1);
        (,,, uint256 collateral,,, InvoiceEscrow.Status status) = escrow.invoices(id);
        assertEq(usdg.balanceOf(address(escrow)), collateral);

        if (status == InvoiceEscrow.Status.Active) {
            vm.prank(customer);
            escrow.repayInvoice(id, repay2);
            (,,, collateral,,,) = escrow.invoices(id);
            assertEq(usdg.balanceOf(address(escrow)), collateral);
        }
        (,,,, uint256 repaid,,) = escrow.invoices(id);
        assertLe(repaid, PRINCIPAL);
        assertEq(usdg.balanceOf(bodega), repaid);
    }

    function test_SetBodegaRegistry_OnlyOwner() public {
        MockBodegaRegistry newRegistry = new MockBodegaRegistry();

        vm.prank(randomWallet);
        vm.expectRevert();
        escrow.setBodegaRegistry(newRegistry);

        vm.prank(owner);
        escrow.setBodegaRegistry(newRegistry);
        assertEq(address(escrow.bodegaRegistry()), address(newRegistry));
    }
}
