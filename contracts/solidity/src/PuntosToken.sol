// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Loyalty/cashback token for Bodegueando. Minted by PaymentRouter on every payment.
contract PuntosToken is ERC20, Ownable {
    address public minter;

    error NotMinter();

    event MinterUpdated(address indexed minter);

    constructor(address initialOwner) ERC20("Puntos Bodegueando", "PUNTOS") Ownable(initialOwner) {}

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    /// @notice Set the PaymentRouter address allowed to mint cashback. Owner-only, callable once
    /// per redeploy of PaymentRouter (e.g. during setup or a future migration).
    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }
}
