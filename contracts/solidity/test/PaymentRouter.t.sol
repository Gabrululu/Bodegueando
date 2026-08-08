// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockFiadoScoring} from "./mocks/MockFiadoScoring.sol";

contract PaymentRouterTest is Test {
    PuntosToken token;
    MockFiadoScoring fiadoScoring;
    PaymentRouter router;

    address owner = makeAddr("owner");
    address bodega = makeAddr("bodega");
    address payer = makeAddr("payer");

    function setUp() public {
        vm.startPrank(owner);
        token = new PuntosToken(owner);
        fiadoScoring = new MockFiadoScoring();
        router = new PaymentRouter(owner, token, fiadoScoring);
        token.setMinter(address(router));
        router.registerBodega(bodega);
        vm.stopPrank();

        vm.deal(payer, 10 ether);
    }

    function test_ReceivePayment_TransfersFundsMintsCashbackAndRecords() public {
        uint256 amount = 1 ether;
        uint256 expectedCashback = (amount * router.cashbackBps()) / 10_000;

        vm.prank(payer);
        router.receivePayment{value: amount}(bodega);

        assertEq(bodega.balance, amount);
        assertEq(token.balanceOf(payer), expectedCashback);
        assertEq(fiadoScoring.paymentsLength(), 1);
        (address recordedBodega, uint256 recordedAmount,) = fiadoScoring.payments(0);
        assertEq(recordedBodega, bodega);
        assertEq(recordedAmount, amount);
    }

    function test_RevertWhen_PayingUnregisteredBodega() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.UnknownBodega.selector);
        router.receivePayment{value: 1 ether}(makeAddr("randomAddress"));
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.ZeroAmount.selector);
        router.receivePayment{value: 0}(bodega);
    }

    function test_RegisterSelf_AnyAddressCanRegisterItself() public {
        address newBodega = makeAddr("newBodega");
        assertFalse(router.isBodega(newBodega));

        vm.prank(newBodega);
        router.registerSelf();

        assertTrue(router.isBodega(newBodega));
    }

    function test_RegisterSelf_MintsBootstrapPuntos() public {
        address newBodega = makeAddr("newBodega");
        assertEq(token.balanceOf(newBodega), 0);

        vm.prank(newBodega);
        router.registerSelf();

        assertEq(token.balanceOf(newBodega), router.BODEGA_BOOTSTRAP_PUNTOS());
    }

    function test_RegisterBodega_MintsBootstrapPuntos() public {
        // `bodega` was registered by the owner in setUp() — assert the bootstrap landed there too.
        assertEq(token.balanceOf(bodega), router.BODEGA_BOOTSTRAP_PUNTOS());
    }

    function test_RevertWhen_NonOwnerCallsRegisterBodega() public {
        vm.prank(payer);
        vm.expectRevert();
        router.registerBodega(makeAddr("someoneElse"));
    }

    function test_OnlyOwnerCanSetCashbackBps() public {
        vm.prank(payer);
        vm.expectRevert();
        router.setCashbackBps(500);

        vm.prank(owner);
        router.setCashbackBps(500);
        assertEq(router.cashbackBps(), 500);
    }

    function test_RevertWhen_CashbackTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(PaymentRouter.CashbackTooHigh.selector);
        router.setCashbackBps(1_001);
    }

    function test_PayFiado_TransfersFundsAndRecordsRepaymentWithoutCashback() public {
        vm.prank(bodega);
        fiadoScoring.extendFiado(payer, 1 ether);
        assertEq(fiadoScoring.getFiadoDebt(bodega, payer), 1 ether);

        uint256 repayAmount = 0.4 ether;
        vm.prank(payer);
        router.payFiado{value: repayAmount}(bodega);

        assertEq(bodega.balance, repayAmount);
        assertEq(token.balanceOf(payer), 0, "repaying fiado should not mint cashback");
        assertEq(fiadoScoring.getFiadoDebt(bodega, payer), 1 ether - repayAmount);
    }

    function test_PayFiado_OverpaymentCapsDebtAtZero() public {
        vm.prank(bodega);
        fiadoScoring.extendFiado(payer, 0.2 ether);

        vm.prank(payer);
        router.payFiado{value: 1 ether}(bodega);

        assertEq(bodega.balance, 1 ether);
        assertEq(fiadoScoring.getFiadoDebt(bodega, payer), 0);
    }

    function test_RevertWhen_PayFiadoUnregisteredBodega() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.UnknownBodega.selector);
        router.payFiado{value: 1 ether}(makeAddr("randomAddress"));
    }

    function test_RevertWhen_PayFiadoZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.ZeroAmount.selector);
        router.payFiado{value: 0}(bodega);
    }
}
