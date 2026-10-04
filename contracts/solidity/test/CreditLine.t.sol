// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditLine, IBodegaRegistry, ICreditCertificate} from "../src/CreditLine.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract MockBodegaRegistry is IBodegaRegistry {
    mapping(address => bool) public isBodega;

    function setBodega(address account, bool value) external {
        isBodega[account] = value;
    }
}

contract MockCreditCertificate is ICreditCertificate {
    mapping(address => uint256) public thresholds;

    function setThreshold(address bodega, uint256 threshold) external {
        thresholds[bodega] = threshold;
    }

    function getCertifiedThreshold(address bodega) external view override returns (uint256) {
        return thresholds[bodega];
    }
}

contract CreditLineTest is Test {
    CreditLine creditLine;
    MockBodegaRegistry registry;
    MockCreditCertificate certificate;
    MockUSDG usdg;

    address owner = makeAddr("owner");
    address lender = makeAddr("lender");
    address lender2 = makeAddr("lender2");
    address bodega = makeAddr("bodega");
    address randomWallet = makeAddr("randomWallet");

    // Stablecoin amounts (USDG, 6 decimals).
    uint256 constant POOL = 1_000e6;
    uint256 constant LOAN = 1_000e6;

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(bodega, true);
        certificate = new MockCreditCertificate();
        usdg = new MockUSDG();
        creditLine = new CreditLine(owner, registry, certificate, IERC20(address(usdg)));

        _fund(lender);
        _fund(lender2);
        _fund(bodega);
        _fund(randomWallet);
    }

    function _fund(address account) internal {
        usdg.mint(account, 10_000e6);
        vm.prank(account);
        usdg.approve(address(creditLine), type(uint256).max);
    }

    function _depositAndBorrow(uint256 threshold) internal returns (uint256 loanId) {
        vm.prank(lender);
        creditLine.deposit(POOL);
        certificate.setThreshold(bodega, threshold);
        vm.prank(bodega);
        loanId = creditLine.borrow(LOAN);
    }

    // --- deposit / withdraw ---

    function test_FirstDepositMintsSharesEqualToAmount() public {
        vm.prank(lender);
        uint256 shares = creditLine.deposit(POOL);
        assertEq(shares, POOL);
        assertEq(creditLine.poolBalance(), POOL);
        assertEq(creditLine.lenderShares(lender), POOL);
        assertEq(usdg.balanceOf(address(creditLine)), POOL);
    }

    function test_WithdrawReturnsProportionalAmount() public {
        vm.prank(lender);
        uint256 shares = creditLine.deposit(POOL);

        uint256 balanceBefore = usdg.balanceOf(lender);
        vm.prank(lender);
        creditLine.withdraw(shares);
        assertEq(usdg.balanceOf(lender), balanceBefore + POOL);
        assertEq(creditLine.poolBalance(), 0);
    }

    function test_RevertWhen_WithdrawingMoreSharesThanOwned() public {
        vm.prank(lender);
        creditLine.deposit(1e6);

        vm.prank(lender2);
        vm.expectRevert(CreditLine.InsufficientShares.selector);
        creditLine.withdraw(1e6);
    }

    function test_DonationDoesNotChangeSharePrice() public {
        vm.prank(lender);
        creditLine.deposit(1e6);
        // Tokens sent directly, bypassing deposit(), are ignored by the internal accounting.
        vm.prank(randomWallet);
        usdg.transfer(address(creditLine), 5_000e6);

        vm.prank(lender2);
        uint256 shares = creditLine.deposit(1e6);
        assertEq(shares, 1e6);
    }

    // --- share accounting with loans outstanding ---

    function test_DepositWhileFullyLentOutPricesSharesAtTotalAssets() public {
        _depositAndBorrow(900); // pool fully lent: poolBalance 0, receivable = principal + 5%
        uint256 owed = LOAN + (LOAN * creditLine.INTEREST_BPS()) / 10_000;
        assertEq(creditLine.poolBalance(), 0);
        assertEq(creditLine.totalAssets(), owed);

        // Used to divide by zero (poolBalance == 0). Now priced at totalAssets.
        vm.prank(lender2);
        uint256 shares = creditLine.deposit(owed);
        assertEq(shares, POOL);
    }

    function test_LateDepositorDoesNotDiluteLenderInterest() public {
        uint256 loanId = _depositAndBorrow(900);

        vm.prank(lender2);
        creditLine.deposit(POOL);

        vm.prank(bodega);
        creditLine.repay(loanId);

        // lender funded the loan and earns its whole 5% interest; lender2 just gets its money back.
        uint256 interest = (LOAN * creditLine.INTEREST_BPS()) / 10_000;
        uint256 lenderShares = creditLine.lenderShares(lender);
        vm.prank(lender);
        creditLine.withdraw(lenderShares);
        assertEq(usdg.balanceOf(lender), 10_000e6 + interest);

        uint256 lender2Shares = creditLine.lenderShares(lender2);
        vm.prank(lender2);
        creditLine.withdraw(lender2Shares);
        assertEq(usdg.balanceOf(lender2), 10_000e6);
    }

    function test_RevertWhen_WithdrawingMoreThanLiquidity() public {
        _depositAndBorrow(900);
        uint256 shares = creditLine.lenderShares(lender);

        vm.prank(lender);
        vm.expectRevert(CreditLine.InsufficientPoolLiquidity.selector);
        creditLine.withdraw(shares);
    }

    // --- borrow ---

    function test_RevertWhen_NonBodegaBorrows() public {
        vm.prank(lender);
        creditLine.deposit(POOL);

        vm.prank(randomWallet);
        vm.expectRevert(CreditLine.NotABodega.selector);
        creditLine.borrow(1e6);
    }

    function test_RevertWhen_BorrowingWithoutCertificate() public {
        vm.prank(lender);
        creditLine.deposit(POOL);

        vm.prank(bodega);
        vm.expectRevert(CreditLine.NoCertificate.selector);
        creditLine.borrow(1e6);
    }

    function test_RevertWhen_CollateralNotApproved() public {
        vm.prank(lender);
        creditLine.deposit(POOL);
        certificate.setThreshold(bodega, 700);
        vm.prank(bodega);
        usdg.approve(address(creditLine), 0);

        vm.prank(bodega);
        vm.expectRevert();
        creditLine.borrow(100e6);
    }

    function test_BorrowWithHighestTierRequiresLeastCollateral() public {
        vm.prank(lender);
        creditLine.deposit(POOL);
        certificate.setThreshold(bodega, 900); // tier: 15%

        assertEq(creditLine.requiredCollateral(bodega, LOAN), 150e6);

        uint256 bodegaBalanceBefore = usdg.balanceOf(bodega);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow(LOAN);

        assertEq(usdg.balanceOf(bodega), bodegaBalanceBefore - 150e6 + LOAN);
        (address loanBodega, uint256 principal, uint256 collateral,,, bool resolved) = creditLine.loans(loanId);
        assertEq(loanBodega, bodega);
        assertEq(principal, LOAN);
        assertEq(collateral, 150e6);
        assertFalse(resolved);
        assertEq(creditLine.poolBalance(), 0);
        assertEq(creditLine.totalReceivable(), LOAN + (LOAN * creditLine.INTEREST_BPS()) / 10_000);
        assertEq(usdg.balanceOf(address(creditLine)), 150e6);
    }

    function test_BorrowWithLowestTierRequiresMostCollateral() public {
        vm.prank(lender);
        creditLine.deposit(POOL);
        certificate.setThreshold(bodega, 500); // tier: 50%

        assertEq(creditLine.requiredCollateral(bodega, LOAN), 500e6);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow(LOAN);
        (,, uint256 collateral,,,) = creditLine.loans(loanId);
        assertEq(collateral, 500e6);
    }

    function test_RevertWhen_BorrowingMoreThanPoolLiquidity() public {
        vm.prank(lender);
        creditLine.deposit(1e6);
        certificate.setThreshold(bodega, 900);

        vm.prank(bodega);
        vm.expectRevert(CreditLine.InsufficientPoolLiquidity.selector);
        creditLine.borrow(LOAN);
    }

    // --- repay ---

    function test_RepayReturnsCollateralAndFundsPool() public {
        uint256 loanId = _depositAndBorrow(900); // 15%

        uint256 owed = LOAN + (LOAN * creditLine.INTEREST_BPS()) / 10_000;
        assertEq(creditLine.amountOwed(loanId), owed);
        uint256 bodegaBalanceBefore = usdg.balanceOf(bodega);

        vm.prank(bodega);
        creditLine.repay(loanId);

        assertEq(usdg.balanceOf(bodega), bodegaBalanceBefore - owed + 150e6);
        assertEq(creditLine.poolBalance(), owed); // pool had 0 left, now has principal+interest back
        assertEq(creditLine.totalReceivable(), 0);
        assertEq(usdg.balanceOf(address(creditLine)), owed);
        (,,,,, bool resolved) = creditLine.loans(loanId);
        assertTrue(resolved);
    }

    function test_RevertWhen_RepayNotApproved() public {
        uint256 loanId = _depositAndBorrow(900);
        vm.prank(bodega);
        usdg.approve(address(creditLine), 0);

        vm.prank(bodega);
        vm.expectRevert();
        creditLine.repay(loanId);
    }

    function test_RevertWhen_NonBorrowerRepays() public {
        uint256 loanId = _depositAndBorrow(900);

        vm.prank(randomWallet);
        vm.expectRevert(CreditLine.NotBorrower.selector);
        creditLine.repay(loanId);
    }

    // --- liquidate ---

    function test_RevertWhen_LiquidatingBeforeDueDate() public {
        uint256 loanId = _depositAndBorrow(900);

        vm.expectRevert(CreditLine.NotYetDue.selector);
        creditLine.liquidate(loanId);
    }

    function test_LiquidateAfterDueDateSeizesCollateralAndRecordsDefault() public {
        uint256 loanId = _depositAndBorrow(900);

        vm.warp(block.timestamp + creditLine.LOAN_DURATION() + 1);
        creditLine.liquidate(loanId);

        assertEq(creditLine.poolBalance(), 150e6); // seized collateral, principal never returned
        assertEq(creditLine.totalReceivable(), 0);
        assertEq(creditLine.totalAssets(), 150e6, "loss is recognized at liquidation");
        assertEq(creditLine.getDefaultCount(bodega), 1);
        (,,,,, bool resolved) = creditLine.loans(loanId);
        assertTrue(resolved);
    }

    function test_RevertWhen_ResolvingLoanTwice() public {
        uint256 loanId = _depositAndBorrow(900);

        vm.warp(block.timestamp + creditLine.LOAN_DURATION() + 1);
        creditLine.liquidate(loanId);

        vm.expectRevert(CreditLine.AlreadyResolved.selector);
        creditLine.liquidate(loanId);
    }

    function testFuzz_ContractHoldsExactlyLiquidityPlusCollateral(uint256 deposit, uint256 borrowAmount) public {
        deposit = bound(deposit, 1e6, 5_000e6);
        borrowAmount = bound(borrowAmount, 1e6, deposit);

        vm.prank(lender);
        creditLine.deposit(deposit);
        certificate.setThreshold(bodega, 700);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow(borrowAmount);

        (,, uint256 collateral,,,) = creditLine.loans(loanId);
        uint256 interest = (borrowAmount * creditLine.INTEREST_BPS()) / 10_000;
        assertEq(usdg.balanceOf(address(creditLine)), creditLine.poolBalance() + collateral);
        assertEq(creditLine.totalAssets(), deposit + interest);

        vm.prank(bodega);
        creditLine.repay(loanId);
        assertEq(usdg.balanceOf(address(creditLine)), creditLine.poolBalance());
        assertEq(creditLine.totalAssets(), deposit + interest);
    }

    function test_SetBodegaRegistry_OnlyOwner() public {
        MockBodegaRegistry newRegistry = new MockBodegaRegistry();

        vm.prank(randomWallet);
        vm.expectRevert();
        creditLine.setBodegaRegistry(newRegistry);

        vm.prank(owner);
        creditLine.setBodegaRegistry(newRegistry);
        assertEq(address(creditLine.bodegaRegistry()), address(newRegistry));
    }
}
