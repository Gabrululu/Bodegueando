// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {DeployUsdgStack} from "../script/DeployUsdgStack.s.sol";
import {PuntosToken} from "../src/PuntosToken.sol";
import {PuntosPaymaster, IBodegaRegistry as IPaymasterRegistry} from "../src/PuntosPaymaster.sol";
import {RewardsCatalog, IBodegaRegistry} from "../src/RewardsCatalog.sol";
import {MockFiadoScoring} from "./mocks/MockFiadoScoring.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

/// @notice Runs the real deploy script end to end against local stand-ins (FiadoScoring is a
/// Stylus contract, so it's mocked), to check the wiring before anyone broadcasts it.
contract DeployUsdgStackTest is Test {
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 constant DEPLOYER_KEY = 0xB0DE6A;

    function test_DeploysAndWiresEverything() public {
        address deployer = vm.addr(DEPLOYER_KEY);
        vm.deal(deployer, 0.005 ether);
        vm.etch(ENTRY_POINT_V07, address(new EntryPoint()).code);

        MockUSDG usdg = new MockUSDG();
        MockFiadoScoring fiado = new MockFiadoScoring();
        fiado.setOwner(deployer);
        PuntosToken puntos = new PuntosToken(deployer);
        RewardsCatalog catalog = new RewardsCatalog(deployer, IBodegaRegistry(address(0xdead)), puntos);
        address aiOracle = makeAddr("aiOracle");

        // The previous paymaster holds most of the ETH; the deployer alone can't fund a new one.
        PuntosPaymaster oldPaymaster = new PuntosPaymaster(
            IEntryPoint(ENTRY_POINT_V07), puntos, IPaymasterRegistry(address(0xdead)), deployer, 2500 ether
        );
        oldPaymaster.deposit{value: 0.015 ether}();

        vm.setEnv("PRIVATE_KEY", vm.toString(DEPLOYER_KEY));
        vm.setEnv("STABLECOIN_ADDRESS", vm.toString(address(usdg)));
        vm.setEnv("FIADO_SCORING_ADDRESS", vm.toString(address(fiado)));
        vm.setEnv("PUNTOS_TOKEN_ADDRESS", vm.toString(address(puntos)));
        vm.setEnv("CREDIT_CERTIFICATE_ADDRESS", vm.toString(makeAddr("creditCertificate")));
        vm.setEnv("AI_ORACLE_ADDRESS", vm.toString(aiOracle));
        vm.setEnv("REWARDS_CATALOG_ADDRESS", vm.toString(address(catalog)));
        vm.setEnv("PAYMASTER_DEPOSIT_ETH", "10000000000000000");
        vm.setEnv("OLD_PAYMASTER_ADDRESS", vm.toString(address(oldPaymaster)));

        DeployUsdgStack.Deployed memory d = new DeployUsdgStack().run();

        assertEq(address(d.router.stablecoin()), address(usdg));
        assertEq(puntos.minter(), address(d.router));
        assertEq(fiado.paymentRouter(), address(d.router));
        assertEq(fiado.aiOracle(), aiOracle);
        assertEq(fiado.escrow(), address(d.escrow));
        assertEq(address(d.paymaster.bodegaRegistry()), address(d.router));
        assertEq(d.paymaster.puntosPerEth(), 2500 ether);
        assertEq(IEntryPoint(ENTRY_POINT_V07).balanceOf(address(d.paymaster)), 0.01 ether);
        assertEq(address(d.escrow.stablecoin()), address(usdg));
        assertEq(address(d.groupOrders.stablecoin()), address(usdg));
        assertEq(address(d.creditLine.stablecoin()), address(usdg));
        assertEq(address(d.creditLine.bodegaRegistry()), address(d.router));
        assertEq(address(catalog.bodegaRegistry()), address(d.router));
        assertEq(d.router.owner(), deployer);
        assertEq(oldPaymaster.getDeposit(), 0, "old paymaster deposit recovered");
        assertEq(deployer.balance, 0.005 ether + 0.015 ether - 0.01 ether);
    }
}
