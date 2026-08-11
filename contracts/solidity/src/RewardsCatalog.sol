// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — same narrow
/// interface BeneficioToken.sol/InvoiceEscrow.sol each declare locally, so RewardsCatalog
/// doesn't need PaymentRouter's whole surface, just "is this address a real bodega?".
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

/// @notice Catálogo de beneficios canjeables por PUNTOS, propio de cada bodega, canjeable
/// por cualquier cliente sin importar en qué bodega ganó esos puntos — la pieza que le
/// faltaba a PuntosToken.sol para ser una red de fidelización real y no solo cashback.
///
/// Dos tipos de beneficio:
/// - `Instant` (ej. "1kg de arroz"): el cliente paga `pointCost` y recibe un código de canje
///   de una vez.
/// - `Raffle` (ej. "canasta navideña"): el cliente paga `pointCost` por cada entrada que
///   quiera comprar; pasada `availableUntil`, la bodega sortea entre todos los entrantes y
///   el ganador recibe su propio código de canje.
///
/// En ambos casos los PUNTOS se cobran al participar, no al retirar — así nadie "reserva"
/// un beneficio sin comprometerse, y `fulfillRedemption` solo cambia estado, nunca mueve
/// fondos. El código de canje (6 dígitos, mismo look & feel que los códigos de bodega/
/// cliente ya usados en el resto de la app) lo valida la propia bodega en el mostrador; su
/// vigencia (`claimWindowSeconds`) la define la bodega por beneficio, no un valor fijo del
/// sistema.
///
/// El sorteo usa `blockhash`/`timestamp` como fuente de aleatoriedad on-chain — manipulable
/// en un grado limitado por quien propone el bloque, pero razonable para un sorteo de bajo
/// valor entre vecinos; no amerita la complejidad de un oráculo VRF externo.
contract RewardsCatalog is Ownable {
    enum RewardKind {
        Instant,
        Raffle
    }

    struct Reward {
        address bodega;
        string title;
        RewardKind kind;
        uint256 pointCost;
        uint64 availableUntil;
        uint64 claimWindowSeconds;
        bool active;
        bool drawn;
        address winner;
    }

    struct Redemption {
        uint256 rewardId;
        address customer;
        uint256 code;
        uint64 expiresAt;
        bool fulfilled;
    }

    /// @notice NOT immutable, on purpose — see PuntosPaymaster.sol's identical field for why.
    IBodegaRegistry public bodegaRegistry;
    IERC20 public immutable puntosToken;

    uint256 public nextRewardId;
    mapping(uint256 => Reward) public rewards;

    uint256 public nextRedemptionId;
    mapping(uint256 => Redemption) public redemptions;

    /// @dev Stores `redemptionId + 1` so `0` unambiguously means "no redemption has this code".
    mapping(uint256 => uint256) public codeToRedemptionId;

    mapping(uint256 => address[]) public entries;

    error NotABodega();
    error NotRewardOwner();
    error ZeroAmount();
    error InvalidDueDate();
    error RewardNotFound();
    error RewardNotActive();
    error RewardExpired();
    error WrongKind();
    error AlreadyDrawn();
    error NotYetDue();
    error NoEntries();
    error RedemptionNotFound();
    error RedemptionExpired();
    error AlreadyFulfilled();

    event RewardCreated(
        uint256 indexed id, address indexed bodega, RewardKind kind, uint256 pointCost, uint64 availableUntil, uint64 claimWindowSeconds
    );
    event RewardActiveSet(uint256 indexed id, bool active);
    event RewardRedeemed(uint256 indexed rewardId, uint256 indexed redemptionId, address indexed customer, uint256 code);
    event RaffleEntered(uint256 indexed rewardId, address indexed customer, uint256 totalEntries);
    event RaffleDrawn(uint256 indexed rewardId, address indexed winner, uint256 indexed redemptionId);
    event RedemptionFulfilled(uint256 indexed redemptionId, uint256 code);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);

    constructor(address initialOwner, IBodegaRegistry _bodegaRegistry, IERC20 _puntosToken) Ownable(initialOwner) {
        bodegaRegistry = _bodegaRegistry;
        puntosToken = _puntosToken;
    }

    /// @notice Repoints the bodega registry after a PaymentRouter redeploy.
    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @notice Bodega registrada crea un beneficio propio. No mueve fondos: los PUNTOS solo
    /// se cobran cuando un cliente participa (`redeemInstant`/`enterRaffle`).
    function createReward(string calldata title, RewardKind kind, uint256 pointCost, uint64 availableUntil, uint64 claimWindowSeconds)
        external
        returns (uint256 id)
    {
        if (!bodegaRegistry.isBodega(msg.sender)) revert NotABodega();
        if (pointCost == 0) revert ZeroAmount();
        if (availableUntil <= block.timestamp) revert InvalidDueDate();
        if (claimWindowSeconds == 0) revert ZeroAmount();

        id = nextRewardId++;
        rewards[id] = Reward({
            bodega: msg.sender,
            title: title,
            kind: kind,
            pointCost: pointCost,
            availableUntil: availableUntil,
            claimWindowSeconds: claimWindowSeconds,
            active: true,
            drawn: false,
            winner: address(0)
        });

        emit RewardCreated(id, msg.sender, kind, pointCost, availableUntil, claimWindowSeconds);
    }

    /// @notice Bodega pausa o reactiva su propio beneficio. No afecta canjes ya emitidos —
    /// alguien que ya pagó puede retirar igual, pausar solo cierra nuevas participaciones.
    function setRewardActive(uint256 id, bool active) external {
        Reward storage reward = rewards[id];
        if (reward.bodega == address(0)) revert RewardNotFound();
        if (reward.bodega != msg.sender) revert NotRewardOwner();

        reward.active = active;
        emit RewardActiveSet(id, active);
    }

    /// @notice Cliente canjea un beneficio `Instant`: paga `pointCost` PUNTOS a la bodega y
    /// recibe un código de canje de una sola vez, válido por `claimWindowSeconds`.
    function redeemInstant(uint256 id) external returns (uint256 redemptionId) {
        Reward storage reward = _requireActiveReward(id);
        if (reward.kind != RewardKind.Instant) revert WrongKind();

        require(puntosToken.transferFrom(msg.sender, reward.bodega, reward.pointCost), "PUNTOS transfer failed");

        redemptionId = _createRedemption(id, msg.sender, reward.claimWindowSeconds);
    }

    /// @notice Cliente compra una entrada para un beneficio `Raffle`, pagando `pointCost`
    /// PUNTOS. Puede entrar más de una vez — cada entrada extra es una chance extra.
    function enterRaffle(uint256 id) external {
        Reward storage reward = _requireActiveReward(id);
        if (reward.kind != RewardKind.Raffle) revert WrongKind();

        require(puntosToken.transferFrom(msg.sender, reward.bodega, reward.pointCost), "PUNTOS transfer failed");

        entries[id].push(msg.sender);
        emit RaffleEntered(id, msg.sender, entries[id].length);
    }

    /// @notice Bodega dueña sortea un beneficio `Raffle` una vez pasada su `availableUntil`.
    /// El ganador recibe su propio código de canje, igual que un `redeemInstant`.
    function drawWinner(uint256 id) external returns (address winner, uint256 redemptionId) {
        Reward storage reward = rewards[id];
        if (reward.bodega == address(0)) revert RewardNotFound();
        if (reward.bodega != msg.sender) revert NotRewardOwner();
        if (reward.kind != RewardKind.Raffle) revert WrongKind();
        if (reward.drawn) revert AlreadyDrawn();
        if (block.timestamp <= reward.availableUntil) revert NotYetDue();

        address[] storage participants = entries[id];
        if (participants.length == 0) revert NoEntries();

        uint256 winnerIndex = uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, id))) % participants.length;
        winner = participants[winnerIndex];

        reward.drawn = true;
        reward.winner = winner;

        redemptionId = _createRedemption(id, winner, reward.claimWindowSeconds);
        emit RaffleDrawn(id, winner, redemptionId);
    }

    /// @notice Bodega valida en el mostrador el código que le muestra el cliente y lo marca
    /// entregado. No mueve PUNTOS — eso ya ocurrió al canjear/ganar.
    function fulfillRedemption(uint256 code) external returns (uint256 redemptionId) {
        uint256 stored = codeToRedemptionId[code];
        if (stored == 0) revert RedemptionNotFound();
        redemptionId = stored - 1;

        Redemption storage redemption = redemptions[redemptionId];
        Reward storage reward = rewards[redemption.rewardId];
        if (reward.bodega != msg.sender) revert NotRewardOwner();
        if (redemption.fulfilled) revert AlreadyFulfilled();
        if (block.timestamp > redemption.expiresAt) revert RedemptionExpired();

        redemption.fulfilled = true;
        emit RedemptionFulfilled(redemptionId, code);
    }

    function getEntries(uint256 id) external view returns (address[] memory) {
        return entries[id];
    }

    function _requireActiveReward(uint256 id) internal view returns (Reward storage reward) {
        reward = rewards[id];
        if (reward.bodega == address(0)) revert RewardNotFound();
        if (!reward.active) revert RewardNotActive();
        if (block.timestamp > reward.availableUntil) revert RewardExpired();
    }

    /// @dev Genera un código de 6 dígitos pseudo-aleatorio, reintentando en el raro caso de
    /// colisión con un código ya emitido (hasta 5 intentos, más que suficiente en un espacio
    /// de 900,000 códigos para la escala de esta app).
    function _createRedemption(uint256 rewardId, address customer, uint64 claimWindowSeconds) internal returns (uint256 redemptionId) {
        redemptionId = nextRedemptionId++;

        uint256 code;
        for (uint256 attempt = 0; attempt < 5; attempt++) {
            code = (uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, customer, redemptionId, attempt))) % 900_000)
                + 100_000;
            if (codeToRedemptionId[code] == 0) break;
        }

        uint64 expiresAt = uint64(block.timestamp) + claimWindowSeconds;
        redemptions[redemptionId] = Redemption({ rewardId: rewardId, customer: customer, code: code, expiresAt: expiresAt, fulfilled: false });
        codeToRedemptionId[code] = redemptionId + 1;

        emit RewardRedeemed(rewardId, redemptionId, customer, code);
    }
}
