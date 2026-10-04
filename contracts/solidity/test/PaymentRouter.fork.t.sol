// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockFiadoScoring} from "./mocks/MockFiadoScoring.sol";

/// @notice Runs PaymentRouter against the real Paxos USDG deployment on an Arbitrum Sepolia fork,
/// to catch anything the 6-decimal mock can't (proxy, pause/freeze hooks, non-standard returns).
/// Skipped unless ARBITRUM_SEPOLIA_RPC_URL is set:
///   ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --mc PaymentRouterForkTest
contract PaymentRouterForkTest is Test {
    IERC20 constant USDG = IERC20(0xFFC95faa3d63Cde504a05B567C600B78C0b41892);

    PuntosToken token;
    MockFiadoScoring fiadoScoring;
    PaymentRouter router;

    address owner = makeAddr("owner");
    address bodega = makeAddr("bodega");
    address payer = makeAddr("payer");

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) vm.skip(true);
        vm.createSelectFork(rpcUrl);

        vm.startPrank(owner);
        token = new PuntosToken(owner);
        fiadoScoring = new MockFiadoScoring();
        router = new PaymentRouter(owner, token, fiadoScoring, USDG);
        token.setMinter(address(router));
        router.registerBodega(bodega);
        vm.stopPrank();

        deal(address(USDG), payer, 100e6);
        vm.prank(payer);
        USDG.approve(address(router), 100e6);
    }

    function test_Fork_RealUsdgPaymentSettlesAndMintsCashback() public {
        assertEq(router.stablecoinScale(), 1e12, "USDG has 6 decimals");

        vm.prank(payer);
        router.receivePayment(bodega, 5e6);

        assertEq(USDG.balanceOf(bodega), 5e6);
        assertEq(USDG.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(payer), 0.1 ether);
        (, uint256 recordedAmount,) = fiadoScoring.payments(0);
        assertEq(recordedAmount, 5 ether);
    }
}
