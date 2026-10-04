// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GroupOrders, IBodegaRegistry} from "../src/GroupOrders.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

/// @notice Test double standing in for PaymentRouter's isBodega registry — same pattern as
/// BeneficioToken.t.sol/InvoiceEscrow.t.sol/RewardsCatalog.t.sol's MockBodegaRegistry.
contract MockBodegaRegistry is IBodegaRegistry {
    mapping(address => bool) public isBodega;

    function setBodega(address account, bool value) external {
        isBodega[account] = value;
    }
}

contract GroupOrdersTest is Test {
    GroupOrders orders;
    MockBodegaRegistry registry;

    address owner = makeAddr("owner");
    address organizer = makeAddr("organizer");
    address contributor1 = makeAddr("contributor1");
    address contributor2 = makeAddr("contributor2");
    address randomWallet = makeAddr("randomWallet");

    MockUSDG usdg;

    // Stablecoin amounts (USDG, 6 decimals).
    uint256 constant GOAL = 1_000e6;
    uint64 constant WITHDRAW_WINDOW = 7 days;

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(organizer, true);
        registry.setBodega(contributor1, true);
        registry.setBodega(contributor2, true);

        usdg = new MockUSDG();
        orders = new GroupOrders(owner, registry, IERC20(address(usdg)));

        _fund(organizer);
        _fund(contributor1);
        _fund(contributor2);
    }

    function _fund(address account) internal {
        usdg.mint(account, 10_000e6);
        vm.prank(account);
        usdg.approve(address(orders), type(uint256).max);
    }

    function _createOrder(uint64 pledgeDeadline) internal returns (uint256 id) {
        vm.prank(organizer);
        id = orders.createGroupOrder("Arroz + aceite", GOAL, pledgeDeadline, WITHDRAW_WINDOW);
    }

    // --- createGroupOrder ---

    function test_OnlyRegisteredBodegaCanCreate() public {
        vm.prank(randomWallet);
        vm.expectRevert(GroupOrders.NotABodega.selector);
        orders.createGroupOrder("x", GOAL, uint64(block.timestamp + 1 days), WITHDRAW_WINDOW);
    }

    function test_RevertWhen_GoalIsZero() public {
        vm.prank(organizer);
        vm.expectRevert(GroupOrders.ZeroAmount.selector);
        orders.createGroupOrder("x", 0, uint64(block.timestamp + 1 days), WITHDRAW_WINDOW);
    }

    function test_RevertWhen_DeadlineInPast() public {
        vm.warp(1_000_000);
        vm.prank(organizer);
        vm.expectRevert(GroupOrders.InvalidDeadline.selector);
        orders.createGroupOrder("x", GOAL, uint64(block.timestamp), WITHDRAW_WINDOW);
    }

    function test_RevertWhen_WithdrawWindowIsZero() public {
        vm.prank(organizer);
        vm.expectRevert(GroupOrders.ZeroAmount.selector);
        orders.createGroupOrder("x", GOAL, uint64(block.timestamp + 1 days), 0);
    }

    // --- pledge ---

    function test_OnlyRegisteredBodegaCanPledge() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));
        _fund(randomWallet);
        vm.prank(randomWallet);
        vm.expectRevert(GroupOrders.NotABodega.selector);
        orders.pledge(id, 100e6);
    }

    function test_PledgeAccumulatesAndTracksPerBodega() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));

        vm.prank(contributor1);
        orders.pledge(id, 400e6);
        vm.prank(contributor2);
        orders.pledge(id, 300e6);
        vm.prank(contributor1);
        orders.pledge(id, 100e6);

        (,,, uint256 pledged,,,) = orders.groupOrders(id);
        assertEq(pledged, 800e6);
        assertEq(orders.pledges(id, contributor1), 500e6);
        assertEq(orders.pledges(id, contributor2), 300e6);
    }

    function test_RevertWhen_PledgingZero() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.ZeroAmount.selector);
        orders.pledge(id, 0);
    }

    function test_RevertWhen_PledgingAfterDeadline() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.warp(deadline + 1);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.PledgingClosed.selector);
        orders.pledge(id, 100e6);
    }

    function test_RevertWhen_PledgingUnknownOrder() public {
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.OrderNotFound.selector);
        orders.pledge(999, 100e6);
    }

    // --- withdraw ---

    function test_RevertWhen_WithdrawingBeforeDeadline() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));
        vm.prank(contributor1);
        orders.pledge(id, GOAL);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.NotYetDue.selector);
        orders.withdraw(id);
    }

    function test_RevertWhen_WithdrawingBelowGoal() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, GOAL / 2);
        vm.warp(deadline + 1);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.GoalNotReached.selector);
        orders.withdraw(id);
    }

    function test_RevertWhen_NonOrganizerWithdraws() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, GOAL);
        vm.warp(deadline + 1);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotOrganizer.selector);
        orders.withdraw(id);
    }

    function test_RevertWhen_WithdrawingAfterWindowExpired() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, GOAL);
        vm.warp(deadline + WITHDRAW_WINDOW + 1);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.WithdrawWindowExpired.selector);
        orders.withdraw(id);
    }

    function test_SuccessfulWithdrawTransfersFullFundAndBlocksFurtherRefunds() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, 600e6);
        vm.prank(contributor2);
        orders.pledge(id, 500e6);
        vm.warp(deadline + 1);

        uint256 organizerBalanceBefore = usdg.balanceOf(organizer);
        vm.prank(organizer);
        orders.withdraw(id);
        assertEq(usdg.balanceOf(organizer), organizerBalanceBefore + 1_100e6);

        (,,,,,, bool withdrawn) = orders.groupOrders(id);
        assertTrue(withdrawn);

        vm.warp(deadline + WITHDRAW_WINDOW + 1);
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotYetRefundable.selector);
        orders.refund(id);
    }

    function test_RevertWhen_WithdrawingTwice() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, GOAL);
        vm.warp(deadline + 1);

        vm.prank(organizer);
        orders.withdraw(id);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.AlreadyWithdrawn.selector);
        orders.withdraw(id);
    }

    // --- refund ---

    function test_RefundWhenGoalNeverReached() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, GOAL / 2);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotYetRefundable.selector);
        orders.refund(id);

        vm.warp(deadline + 1);

        uint256 balanceBefore = usdg.balanceOf(contributor1);
        vm.prank(contributor1);
        orders.refund(id);
        assertEq(usdg.balanceOf(contributor1), balanceBefore + GOAL / 2);
        assertEq(orders.pledges(id, contributor1), 0);
    }

    function test_RefundWhenGoalReachedButOrganizerNeverWithdraws() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, 600e6);
        vm.prank(contributor2);
        orders.pledge(id, 500e6);
        vm.warp(deadline + 1);

        // Goal was reached — refund is not yet allowed inside the withdraw window.
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotYetRefundable.selector);
        orders.refund(id);

        vm.warp(deadline + WITHDRAW_WINDOW + 1);

        uint256 balance1Before = usdg.balanceOf(contributor1);
        vm.prank(contributor1);
        orders.refund(id);
        assertEq(usdg.balanceOf(contributor1), balance1Before + 600e6);

        uint256 balance2Before = usdg.balanceOf(contributor2);
        vm.prank(contributor2);
        orders.refund(id);
        assertEq(usdg.balanceOf(contributor2), balance2Before + 500e6);
    }

    function test_RevertWhen_RefundingTwice() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge(id, GOAL / 2);
        vm.warp(deadline + 1);

        vm.prank(contributor1);
        orders.refund(id);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NothingToRefund.selector);
        orders.refund(id);
    }

    function test_RevertWhen_RefundingWithNothingPledged() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.warp(deadline + 1);

        vm.prank(randomWallet);
        vm.expectRevert(GroupOrders.NothingToRefund.selector);
        orders.refund(id);
    }

    function test_SetBodegaRegistry_OnlyOwner() public {
        MockBodegaRegistry newRegistry = new MockBodegaRegistry();

        vm.prank(randomWallet);
        vm.expectRevert();
        orders.setBodegaRegistry(newRegistry);

        vm.prank(owner);
        orders.setBodegaRegistry(newRegistry);
        assertEq(address(orders.bodegaRegistry()), address(newRegistry));
    }
}
