// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PuntosToken} from "./PuntosToken.sol";
import {IFiadoScoring} from "./interfaces/IFiadoScoring.sol";
import {StablecoinSettlement} from "./StablecoinSettlement.sol";

/// @notice Entry point for a bodega payment. Settles in a USD stablecoin (Paxos USDG on
/// Arbitrum), pulled straight from the payer to the bodega — the router never holds funds.
/// Mints cashback in PuntosToken and records the payment on the FiadoScoring Stylus contract
/// so its on-chain credit score can update.
///
/// Unit of account: every amount this contract hands to PuntosToken or FiadoScoring is in
/// USD-wei (see StablecoinSettlement). That keeps PUNTOS, fiado limits and fiado debt all in
/// one human-meaningful unit — 1 PUNTO = 1 USD of cashback — and lets PuntosPaymaster price
/// gas in that same unit.
contract PaymentRouter is Ownable, StablecoinSettlement {
    using SafeERC20 for IERC20;

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

    constructor(address initialOwner, PuntosToken _puntosToken, IFiadoScoring _fiadoScoring, IERC20 _stablecoin)
        Ownable(initialOwner)
        StablecoinSettlement(_stablecoin)
    {
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
        // Techo duro al 3%: apenas un punto de margen sobre el 2% que ya se usa por defecto,
        // y muy por debajo de la comisión de un POS tradicional (2.5%-3.5%, ver README) —
        // así, aunque PUNTOS algún día se respalde 1:1 con soles reales (roadmap: ePEN), el
        // cashback nunca puede volverse más caro para una bodega que la comisión que está
        // reemplazando. Hoy PUNTOS no tiene respaldo, así que dar cashback no le cuesta nada
        // a la bodega que cobra — este techo es una salvaguarda para cuando eso cambie, no
        // una restricción que afecte la operación actual.
        if (bps > 300) revert CashbackTooHigh();
        cashbackBps = bps;
        emit CashbackBpsUpdated(bps);
    }

    /// @notice Pay a registered bodega `amount` of stablecoin (in its own decimals — 6 for
    /// USDG). Pulled directly from the payer to the bodega, so the payer must have approved
    /// this router first (the frontend batches approve + receivePayment in one UserOperation).
    /// Cashback is minted to the payer in PUNTOS and the payment is recorded on FiadoScoring.
    function receivePayment(address bodega, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!isBodega[bodega]) revert UnknownBodega();

        uint256 normalized = _toUsd18(amount);
        uint256 cashback = (normalized * cashbackBps) / BPS_DENOMINATOR;

        emit PaymentReceived(msg.sender, bodega, amount, cashback);

        stablecoin.safeTransferFrom(msg.sender, bodega, amount);

        if (cashback > 0) {
            puntosToken.mint(msg.sender, cashback);
        }

        fiadoScoring.recordPayment(bodega, normalized, block.timestamp);
    }

    /// @notice Pay back fiado debt owed to `bodega`, `amount` in stablecoin decimals. Moves
    /// funds exactly like receivePayment, but is recorded as a debt repayment on FiadoScoring
    /// instead of a new purchase, so no cashback is minted here (clearing a debt isn't a new
    /// sale to reward).
    function payFiado(address bodega, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!isBodega[bodega]) revert UnknownBodega();

        emit FiadoRepaid(bodega, msg.sender, amount);

        stablecoin.safeTransferFrom(msg.sender, bodega, amount);

        fiadoScoring.repayFiado(bodega, msg.sender, _toUsd18(amount));
    }
}
