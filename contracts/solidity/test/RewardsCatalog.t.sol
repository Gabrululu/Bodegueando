// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RewardsCatalog, IBodegaRegistry} from "../src/RewardsCatalog.sol";
import {PuntosToken} from "../src/PuntosToken.sol";

/// @notice Test double standing in for PaymentRouter's isBodega registry — same pattern as
/// BeneficioToken.t.sol/InvoiceEscrow.t.sol's MockBodegaRegistry.
contract MockBodegaRegistry is IBodegaRegistry {
    mapping(address => bool) public isBodega;

    function setBodega(address account, bool value) external {
        isBodega[account] = value;
    }
}

contract RewardsCatalogTest is Test {
    RewardsCatalog catalog;
    MockBodegaRegistry registry;
    PuntosToken puntos;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address bodega = makeAddr("bodega");
    address customer = makeAddr("customer");
    address customer2 = makeAddr("customer2");
    address randomWallet = makeAddr("randomWallet");

    uint256 constant COST = 100 ether;

    function setUp() public {
        registry = new MockBodegaRegistry();
        registry.setBodega(bodega, true);

        puntos = new PuntosToken(address(this));
        puntos.setMinter(minter);

        catalog = new RewardsCatalog(owner, registry, puntos);

        vm.prank(minter);
        puntos.mint(customer, 1000 ether);
        vm.prank(minter);
        puntos.mint(customer2, 1000 ether);

        vm.prank(customer);
        puntos.approve(address(catalog), type(uint256).max);
        vm.prank(customer2);
        puntos.approve(address(catalog), type(uint256).max);
    }

    function _createInstantReward() internal returns (uint256 id) {
        vm.prank(bodega);
        id = catalog.createReward("1kg de arroz", RewardsCatalog.RewardKind.Instant, COST, uint64(block.timestamp + 7 days), 1 hours);
    }

    function _createRaffleReward(uint64 availableUntil) internal returns (uint256 id) {
        vm.prank(bodega);
        id = catalog.createReward("Canasta navidena", RewardsCatalog.RewardKind.Raffle, COST, availableUntil, 30 days);
    }

    // --- createReward ---

    function test_OnlyRegisteredBodegaCanCreateReward() public {
        vm.prank(randomWallet);
        vm.expectRevert(RewardsCatalog.NotABodega.selector);
        catalog.createReward("x", RewardsCatalog.RewardKind.Instant, COST, uint64(block.timestamp + 1 days), 1 hours);
    }

    function test_RevertWhen_CreatingWithZeroPointCost() public {
        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.ZeroAmount.selector);
        catalog.createReward("x", RewardsCatalog.RewardKind.Instant, 0, uint64(block.timestamp + 1 days), 1 hours);
    }

    function test_RevertWhen_CreatingWithPastDueDate() public {
        vm.warp(1_000_000);
        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.InvalidDueDate.selector);
        catalog.createReward("x", RewardsCatalog.RewardKind.Instant, COST, uint64(block.timestamp), 1 hours);
    }

    function test_RevertWhen_CreatingWithZeroClaimWindow() public {
        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.ZeroAmount.selector);
        catalog.createReward("x", RewardsCatalog.RewardKind.Instant, COST, uint64(block.timestamp + 1 days), 0);
    }

    // --- redeemInstant ---

    function test_RedeemInstantChargesPointsAndGeneratesValidCode() public {
        uint256 id = _createInstantReward();

        uint256 bodegaBalanceBefore = puntos.balanceOf(bodega);
        vm.prank(customer);
        uint256 redemptionId = catalog.redeemInstant(id);

        assertEq(puntos.balanceOf(bodega), bodegaBalanceBefore + COST);
        assertEq(puntos.balanceOf(customer), 1000 ether - COST);

        (uint256 rewardId, address redCustomer, uint256 code, uint64 expiresAt, bool fulfilled) = catalog.redemptions(redemptionId);
        assertEq(rewardId, id);
        assertEq(redCustomer, customer);
        assertTrue(code >= 100_000 && code < 1_000_000);
        assertEq(expiresAt, block.timestamp + 1 hours);
        assertFalse(fulfilled);
    }

    function test_RevertWhen_RedeemingRaffleRewardAsInstant() public {
        uint256 id = _createRaffleReward(uint64(block.timestamp + 7 days));
        vm.prank(customer);
        vm.expectRevert(RewardsCatalog.WrongKind.selector);
        catalog.redeemInstant(id);
    }

    function test_RevertWhen_RedeemingExpiredReward() public {
        uint256 id = _createInstantReward();
        vm.warp(block.timestamp + 8 days);
        vm.prank(customer);
        vm.expectRevert(RewardsCatalog.RewardExpired.selector);
        catalog.redeemInstant(id);
    }

    function test_RevertWhen_RedeemingPausedReward() public {
        uint256 id = _createInstantReward();
        vm.prank(bodega);
        catalog.setRewardActive(id, false);

        vm.prank(customer);
        vm.expectRevert(RewardsCatalog.RewardNotActive.selector);
        catalog.redeemInstant(id);
    }

    function test_RevertWhen_RedeemingUnknownReward() public {
        vm.prank(customer);
        vm.expectRevert(RewardsCatalog.RewardNotFound.selector);
        catalog.redeemInstant(999);
    }

    // --- fulfillRedemption ---

    function test_FulfillRedemptionMarksItFulfilled() public {
        uint256 id = _createInstantReward();
        vm.prank(customer);
        uint256 redemptionId = catalog.redeemInstant(id);
        (,, uint256 code,,) = catalog.redemptions(redemptionId);

        vm.prank(bodega);
        uint256 fulfilledId = catalog.fulfillRedemption(code);
        assertEq(fulfilledId, redemptionId);

        (,,,, bool fulfilled) = catalog.redemptions(redemptionId);
        assertTrue(fulfilled);
    }

    function test_RevertWhen_FulfillingAlreadyFulfilledCode() public {
        uint256 id = _createInstantReward();
        vm.prank(customer);
        uint256 redemptionId = catalog.redeemInstant(id);
        (,, uint256 code,,) = catalog.redemptions(redemptionId);

        vm.prank(bodega);
        catalog.fulfillRedemption(code);

        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.AlreadyFulfilled.selector);
        catalog.fulfillRedemption(code);
    }

    function test_RevertWhen_FulfillingExpiredCode() public {
        uint256 id = _createInstantReward();
        vm.prank(customer);
        uint256 redemptionId = catalog.redeemInstant(id);
        (,, uint256 code,,) = catalog.redemptions(redemptionId);

        vm.warp(block.timestamp + 2 hours);

        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.RedemptionExpired.selector);
        catalog.fulfillRedemption(code);
    }

    function test_RevertWhen_NonOwnerBodegaFulfills() public {
        uint256 id = _createInstantReward();
        vm.prank(customer);
        uint256 redemptionId = catalog.redeemInstant(id);
        (,, uint256 code,,) = catalog.redemptions(redemptionId);

        address otherBodega = makeAddr("otherBodega");
        registry.setBodega(otherBodega, true);
        vm.prank(otherBodega);
        vm.expectRevert(RewardsCatalog.NotRewardOwner.selector);
        catalog.fulfillRedemption(code);
    }

    function test_RevertWhen_FulfillingUnknownCode() public {
        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.RedemptionNotFound.selector);
        catalog.fulfillRedemption(424242);
    }

    // --- setRewardActive ---

    function test_SetRewardActiveOnlyOwner() public {
        uint256 id = _createInstantReward();

        vm.prank(randomWallet);
        vm.expectRevert(RewardsCatalog.NotRewardOwner.selector);
        catalog.setRewardActive(id, false);

        vm.prank(bodega);
        catalog.setRewardActive(id, false);
        (,,,,,, bool active,,) = catalog.rewards(id);
        assertFalse(active);
    }

    // --- enterRaffle / drawWinner ---

    function test_EnterRaffleAccumulatesEntriesAndChargesPointsEachTime() public {
        uint256 id = _createRaffleReward(uint64(block.timestamp + 7 days));

        vm.prank(customer);
        catalog.enterRaffle(id);
        vm.prank(customer);
        catalog.enterRaffle(id);
        vm.prank(customer2);
        catalog.enterRaffle(id);

        address[] memory ents = catalog.getEntries(id);
        assertEq(ents.length, 3);
        assertEq(puntos.balanceOf(customer), 1000 ether - 2 * COST);
        assertEq(puntos.balanceOf(customer2), 1000 ether - COST);
        assertEq(puntos.balanceOf(bodega), 3 * COST);
    }

    function test_RevertWhen_EnteringInstantRewardAsRaffle() public {
        uint256 id = _createInstantReward();
        vm.prank(customer);
        vm.expectRevert(RewardsCatalog.WrongKind.selector);
        catalog.enterRaffle(id);
    }

    function test_RevertWhen_DrawingBeforeAvailableUntil() public {
        uint256 id = _createRaffleReward(uint64(block.timestamp + 7 days));
        vm.prank(customer);
        catalog.enterRaffle(id);

        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.NotYetDue.selector);
        catalog.drawWinner(id);
    }

    function test_RevertWhen_DrawingWithNoEntries() public {
        uint64 dueDate = uint64(block.timestamp + 1 days);
        uint256 id = _createRaffleReward(dueDate);
        vm.warp(dueDate + 1);

        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.NoEntries.selector);
        catalog.drawWinner(id);
    }

    function test_RevertWhen_NonOwnerDraws() public {
        uint64 dueDate = uint64(block.timestamp + 1 days);
        uint256 id = _createRaffleReward(dueDate);
        vm.prank(customer);
        catalog.enterRaffle(id);
        vm.warp(dueDate + 1);

        vm.prank(randomWallet);
        vm.expectRevert(RewardsCatalog.NotRewardOwner.selector);
        catalog.drawWinner(id);
    }

    function test_DrawWinnerPicksParticipantAndCreatesRedemption() public {
        uint64 dueDate = uint64(block.timestamp + 1 days);
        uint256 id = _createRaffleReward(dueDate);
        vm.prank(customer);
        catalog.enterRaffle(id);
        vm.prank(customer2);
        catalog.enterRaffle(id);
        vm.warp(dueDate + 1);

        vm.prank(bodega);
        (address winner, uint256 redemptionId) = catalog.drawWinner(id);

        assertTrue(winner == customer || winner == customer2);
        (,,,,,,, bool drawn, address recordedWinner) = catalog.rewards(id);
        assertTrue(drawn);
        assertEq(recordedWinner, winner);

        (uint256 rewardId, address redCustomer,,,) = catalog.redemptions(redemptionId);
        assertEq(rewardId, id);
        assertEq(redCustomer, winner);
    }

    function test_RevertWhen_DrawingTwice() public {
        uint64 dueDate = uint64(block.timestamp + 1 days);
        uint256 id = _createRaffleReward(dueDate);
        vm.prank(customer);
        catalog.enterRaffle(id);
        vm.warp(dueDate + 1);

        vm.prank(bodega);
        catalog.drawWinner(id);

        vm.prank(bodega);
        vm.expectRevert(RewardsCatalog.AlreadyDrawn.selector);
        catalog.drawWinner(id);
    }

    function test_RevertWhen_EnteringRaffleAfterDrawn() public {
        uint64 dueDate = uint64(block.timestamp + 1 days);
        uint256 id = _createRaffleReward(dueDate);
        vm.prank(customer);
        catalog.enterRaffle(id);
        vm.warp(dueDate + 1);
        vm.prank(bodega);
        catalog.drawWinner(id);

        vm.prank(customer2);
        vm.expectRevert(RewardsCatalog.RewardExpired.selector);
        catalog.enterRaffle(id);
    }

    function test_SetBodegaRegistry_OnlyOwner() public {
        MockBodegaRegistry newRegistry = new MockBodegaRegistry();

        vm.prank(randomWallet);
        vm.expectRevert();
        catalog.setBodegaRegistry(newRegistry);

        vm.prank(owner);
        catalog.setBodegaRegistry(newRegistry);
        assertEq(address(catalog.bodegaRegistry()), address(newRegistry));
    }
}
