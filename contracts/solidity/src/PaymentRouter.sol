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

    /// @notice PUNTOS minted to a bodega the moment it registers. A bodega never earns
    /// cashback the normal way (only the payer does, in receivePayment) — without this, every
    /// bodega account would be stuck after its one free-sponsored UserOperation
    /// (PuntosPaymaster.sol), unable to ever pay gas for setFiadoEnabled/extendFiado again.
    /// This mirrors, for bodegas, what a purchase does for buyers: give them PUNTOS from
    /// their one qualifying on-chain action.
    uint256 public constant BODEGA_BOOTSTRAP_PUNTOS = 0.005 ether;

    error ZeroAmount();
    error UnknownBodega();
    error CashbackTooHigh();

    event BodegaRegistered(address indexed bodega);
    event PaymentReceived(address indexed payer, address indexed bodega, uint256 amount, uint256 cashback);
    event FiadoScoringUpdated(address indexed fiadoScoring);
    event CashbackBpsUpdated(uint256 bps);
    event FiadoRepaid(address indexed bodega, address indexed customer, uint256 amount);

    constructor(address initialOwner, PuntosToken _puntosToken, IFiadoScoring _fiadoScoring) Ownable(initialOwner) {
        puntosToken = _puntosToken;
        fiadoScoring = _fiadoScoring;
    }

    function registerBodega(address bodega) external onlyOwner {
        isBodega[bodega] = true;
        emit BodegaRegistered(bodega);
        puntosToken.mint(bodega, BODEGA_BOOTSTRAP_PUNTOS);
    }

    /// @notice Self-service registration: any address can register itself as a bodega, no
    /// admin approval needed. Safe because isBodega only gates who can be a *recipient* of
    /// receivePayment (a payment the payer themselves chose to send) — it grants no minting
    /// rights and doesn't affect FiadoScoring's own msg.sender-gated fiado toggle. Mints
    /// BODEGA_BOOTSTRAP_PUNTOS to the caller so they can actually operate afterward (toggle
    /// fiado, extend fiado to customers) — see the constant's doc for why this is needed.
    function registerSelf() external {
        isBodega[msg.sender] = true;
        emit BodegaRegistered(msg.sender);
        puntosToken.mint(msg.sender, BODEGA_BOOTSTRAP_PUNTOS);
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

    /// @notice Pay back fiado debt owed to `bodega`. `msg.value` is the repayment amount,
    /// forwarded to the bodega exactly like receivePayment — but recorded as a debt repayment
    /// on FiadoScoring instead of a new purchase, so no cashback is minted here (clearing a
    /// debt isn't a new sale to reward).
    function payFiado(address bodega) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (!isBodega[bodega]) revert UnknownBodega();

        (bool sent,) = payable(bodega).call{value: msg.value}("");
        require(sent, "transfer to bodega failed");

        fiadoScoring.repayFiado(bodega, msg.sender, msg.value);

        emit FiadoRepaid(bodega, msg.sender, msg.value);
    }
}
