// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {StablecoinSettlement} from "../src/StablecoinSettlement.sol";
import {MockFiadoScoring} from "./mocks/MockFiadoScoring.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice An 18+ decimal token, to check the router refuses stablecoins it can't normalize.
contract MockWeirdDecimals is ERC20 {
    constructor() ERC20("Weird", "WRD") {}

    function decimals() public pure override returns (uint8) {
        return 24;
    }
}

contract PaymentRouterTest is Test {
    PuntosToken token;
    MockFiadoScoring fiadoScoring;
    PaymentRouter router;
    MockUSDG usdg;

    address owner = makeAddr("owner");
    address bodega = makeAddr("bodega");
    address payer = makeAddr("payer");

    function setUp() public {
        vm.startPrank(owner);
        token = new PuntosToken(owner);
        fiadoScoring = new MockFiadoScoring();
        usdg = new MockUSDG();
        router = new PaymentRouter(owner, token, fiadoScoring, IERC20(address(usdg)));
        token.setMinter(address(router));
        router.registerBodega(bodega);
        vm.stopPrank();

        usdg.mint(payer, 100e6);
        vm.prank(payer);
        usdg.approve(address(router), type(uint256).max);
    }

    function test_Constructor_DerivesScaleFromDecimals() public view {
        assertEq(address(router.stablecoin()), address(usdg));
        assertEq(router.stablecoinScale(), 1e12);
    }

    function test_RevertWhen_StablecoinHasMoreThan18Decimals() public {
        MockWeirdDecimals weird = new MockWeirdDecimals();
        vm.expectRevert(StablecoinSettlement.UnsupportedDecimals.selector);
        new PaymentRouter(owner, token, fiadoScoring, IERC20(address(weird)));
    }

    function test_ReceivePayment_TransfersFundsMintsCashbackAndRecords() public {
        uint256 amount = 5e6; // 5 USDG

        vm.prank(payer);
        router.receivePayment(bodega, amount);

        assertEq(usdg.balanceOf(bodega), amount);
        assertEq(usdg.balanceOf(payer), 95e6);
        assertEq(usdg.balanceOf(address(router)), 0, "router must never hold funds");
        // 2% of 5 USD = 0.1 USD of cashback, in 18-decimal PUNTOS.
        assertEq(token.balanceOf(payer), 0.1 ether);
        assertEq(fiadoScoring.paymentsLength(), 1);
        (address recordedBodega, uint256 recordedAmount,) = fiadoScoring.payments(0);
        assertEq(recordedBodega, bodega);
        assertEq(recordedAmount, 5 ether, "FiadoScoring records USD normalized to 18 decimals");
    }

    function test_ReceivePayment_EmitsAmountInStablecoinDecimals() public {
        vm.expectEmit(true, true, false, true);
        emit PaymentRouter.PaymentReceived(payer, bodega, 5e6, 0.1 ether);
        vm.prank(payer);
        router.receivePayment(bodega, 5e6);
    }

    function test_RevertWhen_PaymentNotApproved() public {
        address stranger = makeAddr("stranger");
        usdg.mint(stranger, 10e6);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, 1e6)
        );
        router.receivePayment(bodega, 1e6);
    }

    function test_RevertWhen_PaymentExceedsBalance() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, payer, 100e6, 101e6));
        router.receivePayment(bodega, 101e6);
    }

    function test_RevertWhen_PayingUnregisteredBodega() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.UnknownBodega.selector);
        router.receivePayment(makeAddr("randomAddress"), 1e6);
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.ZeroAmount.selector);
        router.receivePayment(bodega, 0);
    }

    function testFuzz_ReceivePayment_CashbackMatchesBps(uint256 amount) public {
        amount = bound(amount, 1, 100e6);

        vm.prank(payer);
        router.receivePayment(bodega, amount);

        assertEq(usdg.balanceOf(bodega), amount);
        assertEq(token.balanceOf(payer), (amount * 1e12 * router.cashbackBps()) / 10_000);
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

    function test_RegisterBodega_MintsBootstrapPuntos() public view {
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
        router.setCashbackBps(250);

        vm.prank(owner);
        router.setCashbackBps(250);
        assertEq(router.cashbackBps(), 250);
    }

    function test_CashbackBpsAcceptsExactCap() public {
        vm.prank(owner);
        router.setCashbackBps(300);
        assertEq(router.cashbackBps(), 300);
    }

    function test_RevertWhen_CashbackTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(PaymentRouter.CashbackTooHigh.selector);
        router.setCashbackBps(301);
    }

    function test_PayFiado_TransfersFundsAndRecordsRepaymentWithoutCashback() public {
        // Fiado debt lives in USD-wei (18 decimals), same unit FiadoScoring records payments in.
        vm.prank(bodega);
        fiadoScoring.extendFiado(payer, 10 ether);
        assertEq(fiadoScoring.getFiadoDebt(bodega, payer), 10 ether);

        vm.prank(payer);
        router.payFiado(bodega, 4e6); // 4 USDG

        assertEq(usdg.balanceOf(bodega), 4e6);
        assertEq(token.balanceOf(payer), 0, "repaying fiado should not mint cashback");
        assertEq(fiadoScoring.getFiadoDebt(bodega, payer), 6 ether);
    }

    function test_PayFiado_OverpaymentCapsDebtAtZero() public {
        vm.prank(bodega);
        fiadoScoring.extendFiado(payer, 2 ether);

        vm.prank(payer);
        router.payFiado(bodega, 10e6);

        assertEq(usdg.balanceOf(bodega), 10e6);
        assertEq(fiadoScoring.getFiadoDebt(bodega, payer), 0);
    }

    function test_RevertWhen_PayFiadoUnregisteredBodega() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.UnknownBodega.selector);
        router.payFiado(makeAddr("randomAddress"), 1e6);
    }

    function test_RevertWhen_PayFiadoZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.ZeroAmount.selector);
        router.payFiado(bodega, 0);
    }
}
