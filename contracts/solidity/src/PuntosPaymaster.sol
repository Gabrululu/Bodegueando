// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BasePaymaster} from "account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @notice ERC-4337 paymaster that lets a Bodegueando smart account pay gas with its own
/// PUNTOS (cashback) balance instead of holding native ETH. Every account's very first
/// sponsored UserOperation is free (the app "gives" a new user their first bit of gas, same
/// as topping up a fresh account); from the second one onward, the account must have
/// approved this contract to spend PUNTOS, and each UserOperation's actual gas cost is
/// pulled directly in PUNTOS.
///
/// No price oracle is needed for the PUNTOS<->ETH conversion: PaymentRouter mints PUNTOS in
/// the exact same unit as the ETH payment it came from (`cashback = msg.value * cashbackBps /
/// 10_000`, i.e. wei), so 1 wei of gas cost is charged as 1 wei of PUNTOS, 1:1, always.
///
/// The contract itself must hold real ETH (deposited into the EntryPoint via the inherited
/// `deposit()`/`addStake()` from BasePaymaster) to actually pay the bundler/network — PUNTOS
/// collected here are the *accounting* side of "the user paid for their gas", not the ETH
/// itself. See README for how that ETH deposit is funded and replenished.
contract PuntosPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    IERC20 public immutable puntosToken;

    /// @notice Whether an account has already used its one free sponsored UserOperation.
    mapping(address => bool) public hasBootstrapped;

    error InsufficientPuntosAllowance();
    error InsufficientPuntosBalance();

    event GasChargedInPuntos(address indexed account, uint256 amount);
    event FreeBootstrapUsed(address indexed account);
    event PuntosSwept(address indexed to, uint256 amount);

    constructor(IEntryPoint _entryPoint, IERC20 _puntosToken, address _owner) BasePaymaster(_entryPoint) {
        puntosToken = _puntosToken;
        _transferOwnership(_owner);
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        address account = userOp.sender;

        if (!hasBootstrapped[account]) {
            // First-ever sponsored operation for this account: free, no PUNTOS check.
            return (abi.encode(account, false), 0);
        }

        if (puntosToken.allowance(account, address(this)) < maxCost) revert InsufficientPuntosAllowance();
        if (puntosToken.balanceOf(account) < maxCost) revert InsufficientPuntosBalance();

        return (abi.encode(account, true), 0);
    }

    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256) internal override {
        (address account, bool chargeable) = abi.decode(context, (address, bool));

        if (!chargeable) {
            // Only burn the one free bootstrap if the account's own call actually succeeded.
            // If it reverted (wrong bodega code, insufficient funds, whatever), the account
            // never got any real use out of its "free" transaction and never earned any
            // PUNTOS from it either — marking it bootstrapped anyway would permanently lock
            // that account out (no free tx left, 0 PUNTOS balance to pay for the next one).
            if (mode == PostOpMode.opSucceeded) {
                hasBootstrapped[account] = true;
                emit FreeBootstrapUsed(account);
            }
            return;
        }

        // Best-effort: if the account's PUNTOS balance/allowance dropped between validation
        // and here (shouldn't happen within one atomic UserOp, but never trust two reads
        // across a state-changing call), cap the charge instead of reverting — the paymaster
        // already paid the real gas either way, and reverting postOp is far more disruptive.
        uint256 available = puntosToken.allowance(account, address(this));
        uint256 balance = puntosToken.balanceOf(account);
        if (balance < available) available = balance;
        uint256 charge = actualGasCost > available ? available : actualGasCost;

        if (charge > 0) {
            puntosToken.safeTransferFrom(account, address(this), charge);
            emit GasChargedInPuntos(account, charge);
        }
    }

    /// @notice Owner can sweep PUNTOS collected as gas payment (e.g. to burn them or route
    /// them back into the cashback pool). Doesn't touch the ETH deposit — that's managed via
    /// the inherited withdrawTo().
    function sweepPuntos(address to, uint256 amount) external onlyOwner {
        puntosToken.safeTransfer(to, amount);
        emit PuntosSwept(to, amount);
    }
}
