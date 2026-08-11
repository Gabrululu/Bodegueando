// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GroupOrders, IBodegaRegistry} from "../src/GroupOrders.sol";

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

    uint256 constant GOAL = 1 ether;
    uint64 constant WITHDRAW_WINDOW = 7 days;

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(organizer, true);
        registry.setBodega(contributor1, true);
        registry.setBodega(contributor2, true);

        orders = new GroupOrders(owner, registry);

        vm.deal(organizer, 10 ether);
        vm.deal(contributor1, 10 ether);
        vm.deal(contributor2, 10 ether);
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
        vm.deal(randomWallet, 1 ether);
        vm.prank(randomWallet);
        vm.expectRevert(GroupOrders.NotABodega.selector);
        orders.pledge{value: 0.1 ether}(id);
    }

    function test_PledgeAccumulatesAndTracksPerBodega() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));

        vm.prank(contributor1);
        orders.pledge{value: 0.4 ether}(id);
        vm.prank(contributor2);
        orders.pledge{value: 0.3 ether}(id);
        vm.prank(contributor1);
        orders.pledge{value: 0.1 ether}(id);

        (,,, uint256 pledged,,,) = orders.groupOrders(id);
        assertEq(pledged, 0.8 ether);
        assertEq(orders.pledges(id, contributor1), 0.5 ether);
        assertEq(orders.pledges(id, contributor2), 0.3 ether);
    }

    function test_RevertWhen_PledgingZero() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.ZeroAmount.selector);
        orders.pledge{value: 0}(id);
    }

    function test_RevertWhen_PledgingAfterDeadline() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.warp(deadline + 1);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.PledgingClosed.selector);
        orders.pledge{value: 0.1 ether}(id);
    }

    function test_RevertWhen_PledgingUnknownOrder() public {
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.OrderNotFound.selector);
        orders.pledge{value: 0.1 ether}(999);
    }

    // --- withdraw ---

    function test_RevertWhen_WithdrawingBeforeDeadline() public {
        uint256 id = _createOrder(uint64(block.timestamp + 1 days));
        vm.prank(contributor1);
        orders.pledge{value: GOAL}(id);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.NotYetDue.selector);
        orders.withdraw(id);
    }

    function test_RevertWhen_WithdrawingBelowGoal() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge{value: GOAL / 2}(id);
        vm.warp(deadline + 1);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.GoalNotReached.selector);
        orders.withdraw(id);
    }

    function test_RevertWhen_NonOrganizerWithdraws() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge{value: GOAL}(id);
        vm.warp(deadline + 1);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotOrganizer.selector);
        orders.withdraw(id);
    }

    function test_RevertWhen_WithdrawingAfterWindowExpired() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge{value: GOAL}(id);
        vm.warp(deadline + WITHDRAW_WINDOW + 1);

        vm.prank(organizer);
        vm.expectRevert(GroupOrders.WithdrawWindowExpired.selector);
        orders.withdraw(id);
    }

    function test_SuccessfulWithdrawTransfersFullFundAndBlocksFurtherRefunds() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge{value: 0.6 ether}(id);
        vm.prank(contributor2);
        orders.pledge{value: 0.5 ether}(id);
        vm.warp(deadline + 1);

        uint256 organizerBalanceBefore = organizer.balance;
        vm.prank(organizer);
        orders.withdraw(id);
        assertEq(organizer.balance, organizerBalanceBefore + 1.1 ether);

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
        orders.pledge{value: GOAL}(id);
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
        orders.pledge{value: GOAL / 2}(id);

        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotYetRefundable.selector);
        orders.refund(id);

        vm.warp(deadline + 1);

        uint256 balanceBefore = contributor1.balance;
        vm.prank(contributor1);
        orders.refund(id);
        assertEq(contributor1.balance, balanceBefore + GOAL / 2);
        assertEq(orders.pledges(id, contributor1), 0);
    }

    function test_RefundWhenGoalReachedButOrganizerNeverWithdraws() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge{value: 0.6 ether}(id);
        vm.prank(contributor2);
        orders.pledge{value: 0.5 ether}(id);
        vm.warp(deadline + 1);

        // Goal was reached — refund is not yet allowed inside the withdraw window.
        vm.prank(contributor1);
        vm.expectRevert(GroupOrders.NotYetRefundable.selector);
        orders.refund(id);

        vm.warp(deadline + WITHDRAW_WINDOW + 1);

        uint256 balance1Before = contributor1.balance;
        vm.prank(contributor1);
        orders.refund(id);
        assertEq(contributor1.balance, balance1Before + 0.6 ether);

        uint256 balance2Before = contributor2.balance;
        vm.prank(contributor2);
        orders.refund(id);
        assertEq(contributor2.balance, balance2Before + 0.5 ether);
    }

    function test_RevertWhen_RefundingTwice() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _createOrder(deadline);
        vm.prank(contributor1);
        orders.pledge{value: GOAL / 2}(id);
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
