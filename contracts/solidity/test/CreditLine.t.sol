// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CreditLine, IBodegaRegistry, ICreditCertificate} from "../src/CreditLine.sol";

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

    address owner = makeAddr("owner");
    address lender = makeAddr("lender");
    address lender2 = makeAddr("lender2");
    address bodega = makeAddr("bodega");
    address randomWallet = makeAddr("randomWallet");

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(bodega, true);
        certificate = new MockCreditCertificate();
        creditLine = new CreditLine(owner, registry, certificate);

        vm.deal(lender, 100 ether);
        vm.deal(lender2, 100 ether);
        vm.deal(bodega, 100 ether);
    }

    // --- deposit / withdraw ---

    function test_FirstDepositMintsSharesEqualToAmount() public {
        vm.prank(lender);
        uint256 shares = creditLine.deposit{value: 10 ether}();
        assertEq(shares, 10 ether);
        assertEq(creditLine.poolBalance(), 10 ether);
        assertEq(creditLine.lenderShares(lender), 10 ether);
    }

    function test_WithdrawReturnsProportionalAmount() public {
        vm.prank(lender);
        uint256 shares = creditLine.deposit{value: 10 ether}();

        uint256 balanceBefore = lender.balance;
        vm.prank(lender);
        creditLine.withdraw(shares);
        assertEq(lender.balance, balanceBefore + 10 ether);
        assertEq(creditLine.poolBalance(), 0);
    }

    function test_RevertWhen_WithdrawingMoreSharesThanOwned() public {
        vm.prank(lender);
        creditLine.deposit{value: 1 ether}();

        vm.prank(lender2);
        vm.expectRevert(CreditLine.InsufficientShares.selector);
        creditLine.withdraw(1 ether);
    }

    // --- borrow ---

    function test_RevertWhen_NonBodegaBorrows() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();

        vm.deal(randomWallet, 10 ether);
        vm.prank(randomWallet);
        vm.expectRevert(CreditLine.NotABodega.selector);
        creditLine.borrow{value: 1 ether}(1 ether);
    }

    function test_RevertWhen_BorrowingWithoutCertificate() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();

        vm.prank(bodega);
        vm.expectRevert(CreditLine.NoCertificate.selector);
        creditLine.borrow{value: 1 ether}(1 ether);
    }

    function test_RevertWhen_CollateralAmountWrong() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 700); // tier: 30%

        vm.prank(bodega);
        vm.expectRevert(CreditLine.WrongCollateralAmount.selector);
        creditLine.borrow{value: 0.1 ether}(1 ether);
    }

    function test_BorrowWithHighestTierRequiresLeastCollateral() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900); // tier: 15%

        uint256 bodegaBalanceBefore = bodega.balance;
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        assertEq(bodega.balance, bodegaBalanceBefore - 1.5 ether + 10 ether);
        (address loanBodega, uint256 principal, uint256 collateral,,, bool resolved) = creditLine.loans(loanId);
        assertEq(loanBodega, bodega);
        assertEq(principal, 10 ether);
        assertEq(collateral, 1.5 ether);
        assertFalse(resolved);
        assertEq(creditLine.poolBalance(), 0);
    }

    function test_BorrowWithLowestTierRequiresMostCollateral() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 500); // tier: 50%

        vm.prank(bodega);
        creditLine.borrow{value: 5 ether}(10 ether);
        // Reached exactly via 50% of 10 ether — no revert means the tier math is right.
    }

    function test_RevertWhen_BorrowingMoreThanPoolLiquidity() public {
        vm.prank(lender);
        creditLine.deposit{value: 1 ether}();
        certificate.setThreshold(bodega, 900);

        vm.prank(bodega);
        vm.expectRevert(CreditLine.InsufficientPoolLiquidity.selector);
        creditLine.borrow{value: 1.5 ether}(10 ether);
    }

    // --- repay ---

    function test_RepayReturnsCollateralAndFundsPool() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900); // 15%

        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        uint256 owed = 10 ether + (10 ether * creditLine.INTEREST_BPS()) / 10_000;
        uint256 bodegaBalanceBefore = bodega.balance;

        vm.prank(bodega);
        creditLine.repay{value: owed}(loanId);

        assertEq(bodega.balance, bodegaBalanceBefore - owed + 1.5 ether);
        assertEq(creditLine.poolBalance(), owed); // pool had 0 left, now has principal+interest back
        (,,,,, bool resolved) = creditLine.loans(loanId);
        assertTrue(resolved);
    }

    function test_RevertWhen_RepayAmountWrong() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        vm.prank(bodega);
        vm.expectRevert(CreditLine.WrongRepayAmount.selector);
        creditLine.repay{value: 1 ether}(loanId);
    }

    function test_RevertWhen_NonBorrowerRepays() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        vm.deal(randomWallet, 20 ether);
        vm.prank(randomWallet);
        vm.expectRevert(CreditLine.NotBorrower.selector);
        creditLine.repay{value: 10.5 ether}(loanId);
    }

    // --- liquidate ---

    function test_RevertWhen_LiquidatingBeforeDueDate() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        vm.expectRevert(CreditLine.NotYetDue.selector);
        creditLine.liquidate(loanId);
    }

    function test_LiquidateAfterDueDateSeizesCollateralAndRecordsDefault() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        vm.warp(block.timestamp + creditLine.LOAN_DURATION() + 1);
        creditLine.liquidate(loanId);

        assertEq(creditLine.poolBalance(), 1.5 ether); // seized collateral, principal never returned
        assertEq(creditLine.getDefaultCount(bodega), 1);
        (,,,,, bool resolved) = creditLine.loans(loanId);
        assertTrue(resolved);
    }

    function test_RevertWhen_ResolvingLoanTwice() public {
        vm.prank(lender);
        creditLine.deposit{value: 10 ether}();
        certificate.setThreshold(bodega, 900);
        vm.prank(bodega);
        uint256 loanId = creditLine.borrow{value: 1.5 ether}(10 ether);

        vm.warp(block.timestamp + creditLine.LOAN_DURATION() + 1);
        creditLine.liquidate(loanId);

        vm.expectRevert(CreditLine.AlreadyResolved.selector);
        creditLine.liquidate(loanId);
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
