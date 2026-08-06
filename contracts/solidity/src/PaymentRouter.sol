// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PuntosToken} from "./PuntosToken.sol";
import {IFiadoScoring} from "./interfaces/IFiadoScoring.sol";

/// @notice Entry point for a bodega payment. Accepts native testnet ETH standing in for "eSol"
/// (a hackathon shortcut — see README for why) mints cashback in PuntosToken, and records the
/// payment on the FiadoScoring Stylus contract so its on-chain credit score can update.
contract PaymentRouter is Ownable {
    PuntosToken public immutable puntosToken;
    IFiadoScoring public fiadoScoring;

    /// @notice Cashback rate in basis points (e.g. 200 = 2%).
    uint256 public cashbackBps = 200;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    mapping(address => bool) public isBodega;

    error ZeroAmount();
    error UnknownBodega();
    error CashbackTooHigh();

    event BodegaRegistered(address indexed bodega);
    event PaymentReceived(address indexed payer, address indexed bodega, uint256 amount, uint256 cashback);
    event FiadoScoringUpdated(address indexed fiadoScoring);
    event CashbackBpsUpdated(uint256 bps);

    constructor(address initialOwner, PuntosToken _puntosToken, IFiadoScoring _fiadoScoring) Ownable(initialOwner) {
        puntosToken = _puntosToken;
        fiadoScoring = _fiadoScoring;
    }

    function registerBodega(address bodega) external onlyOwner {
        isBodega[bodega] = true;
        emit BodegaRegistered(bodega);
    }

    function setFiadoScoring(IFiadoScoring _fiadoScoring) external onlyOwner {
        fiadoScoring = _fiadoScoring;
        emit FiadoScoringUpdated(address(_fiadoScoring));
    }

    function setCashbackBps(uint256 bps) external onlyOwner {
        if (bps > 1_000) revert CashbackTooHigh(); // hard cap at 10%
        cashbackBps = bps;
        emit CashbackBpsUpdated(bps);
    }

    /// @notice Pay a registered bodega. `msg.value` is the payment amount (native testnet ETH
    /// standing in for eSol). Cashback is minted to the payer in PuntosToken and the payment is
    /// recorded on FiadoScoring for credit scoring.
    function receivePayment(address bodega) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (!isBodega[bodega]) revert UnknownBodega();

        uint256 cashback = (msg.value * cashbackBps) / BPS_DENOMINATOR;

        (bool sent,) = payable(bodega).call{value: msg.value}("");
        require(sent, "transfer to bodega failed");

        if (cashback > 0) {
            puntosToken.mint(msg.sender, cashback);
        }

        fiadoScoring.recordPayment(bodega, msg.value, block.timestamp);

        emit PaymentReceived(msg.sender, bodega, msg.value, cashback);
    }
}
