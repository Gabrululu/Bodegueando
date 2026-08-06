// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PuntosToken} from "../src/PuntosToken.sol";

contract PuntosTokenTest is Test {
    PuntosToken token;
    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address user = makeAddr("user");

    function setUp() public {
        vm.prank(owner);
        token = new PuntosToken(owner);
    }

    function test_OnlyOwnerCanSetMinter() public {
        vm.prank(user);
        vm.expectRevert();
        token.setMinter(minter);

        vm.prank(owner);
        token.setMinter(minter);
        assertEq(token.minter(), minter);
    }

    function test_OnlyMinterCanMint() public {
        vm.prank(owner);
        token.setMinter(minter);

        vm.prank(user);
        vm.expectRevert(PuntosToken.NotMinter.selector);
        token.mint(user, 100);

        vm.prank(minter);
        token.mint(user, 100);
        assertEq(token.balanceOf(user), 100);
    }
}
