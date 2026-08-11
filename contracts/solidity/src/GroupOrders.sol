// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — same narrow
/// interface BeneficioToken.sol/InvoiceEscrow.sol/RewardsCatalog.sol each declare locally.
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

/// @notice Compras conjuntas entre bodegas: una bodega alejada suele perder ventas porque el
/// distribuidor no llega hasta ella, o porque el pedido mínimo que exige el distribuidor es
/// más de lo que una sola bodega necesita. Este contrato junta el aporte de varias bodegas
/// hacia una meta en ETH (el mismo stand-in de eSol que usa el resto de la app) hasta
/// alcanzar ese mínimo; la bodega organizadora retira el fondo para comprarle al distribuidor
/// en la vida real (no es un actor on-chain) y reparte la mercadería según lo que aportó cada
/// una — ese reparto es física/manual, este contrato solo deja el registro auditable de quién
/// aportó cuánto.
///
/// No modela unidades ni catálogo de productos (mismo motivo que BeneficioToken.sol no
/// modela categorías de gasto: sería simular una funcionalidad que no existe en el resto de
/// la app). Tampoco filtra por cercanía geográfica on-chain a propósito: la ubicación de una
/// bodega no necesita ser trustless (mismo criterio que el mapa de bodegas), así que ese
/// filtro vive en el frontend (BodegaOwnerPanel.tsx), no acá — ver ARCHITECTURE.md, sección
/// GroupOrders, para el detalle de cómo se usa la ubicación fuera de la cadena.
///
/// Confianza: solo la organizadora puede retirar, y solo una vez alcanzada la meta — mismo
/// nivel de confianza que ya usan InvoiceEscrow.sol/RewardsCatalog.sol. Si la organizadora
/// nunca retira dentro de `withdrawWindowSeconds` después del cierre de aportes, cualquier
/// bodega que aportó puede reclamar su parte de vuelta — el fondo nunca queda atrapado para
/// siempre.
contract GroupOrders is Ownable {
    struct GroupOrder {
        address organizer;
        string title;
        uint256 goal;
        uint256 pledged;
        uint64 pledgeDeadline;
        uint64 withdrawWindowSeconds;
        bool withdrawn;
    }

    /// @notice NOT immutable, on purpose — see PuntosPaymaster.sol's identical field for why.
    IBodegaRegistry public bodegaRegistry;

    uint256 public nextGroupOrderId;
    mapping(uint256 => GroupOrder) public groupOrders;
    mapping(uint256 => mapping(address => uint256)) public pledges;

    error NotABodega();
    error ZeroAmount();
    error InvalidDeadline();
    error OrderNotFound();
    error PledgingClosed();
    error NotYetDue();
    error GoalNotReached();
    error NotOrganizer();
    error AlreadyWithdrawn();
    error WithdrawWindowExpired();
    error NotYetRefundable();
    error NothingToRefund();

    event GroupOrderCreated(
        uint256 indexed id, address indexed organizer, uint256 goal, uint64 pledgeDeadline, uint64 withdrawWindowSeconds
    );
    event Pledged(uint256 indexed id, address indexed bodega, uint256 amount, uint256 totalPledged);
    event Withdrawn(uint256 indexed id, address indexed organizer, uint256 amount);
    event Refunded(uint256 indexed id, address indexed bodega, uint256 amount);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);

    constructor(address initialOwner, IBodegaRegistry _bodegaRegistry) Ownable(initialOwner) {
        bodegaRegistry = _bodegaRegistry;
    }

    /// @notice Repoints the bodega registry after a PaymentRouter redeploy.
    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @notice Bodega registrada organiza un pedido grupal. `goal` es el mínimo en ETH a
    /// juntar, `pledgeDeadline` hasta cuándo se puede aportar, `withdrawWindowSeconds` el
    /// plazo de gracia que la organizadora tiene para retirar después de `pledgeDeadline` una
    /// vez alcanzado `goal`.
    function createGroupOrder(string calldata title, uint256 goal, uint64 pledgeDeadline, uint64 withdrawWindowSeconds)
        external
        returns (uint256 id)
    {
        if (!bodegaRegistry.isBodega(msg.sender)) revert NotABodega();
        if (goal == 0) revert ZeroAmount();
        if (pledgeDeadline <= block.timestamp) revert InvalidDeadline();
        if (withdrawWindowSeconds == 0) revert ZeroAmount();

        id = nextGroupOrderId++;
        groupOrders[id] = GroupOrder({
            organizer: msg.sender,
            title: title,
            goal: goal,
            pledged: 0,
            pledgeDeadline: pledgeDeadline,
            withdrawWindowSeconds: withdrawWindowSeconds,
            withdrawn: false
        });

        emit GroupOrderCreated(id, msg.sender, goal, pledgeDeadline, withdrawWindowSeconds);
    }

    /// @notice Cualquier bodega registrada (incluida la organizadora) aporta ETH antes de
    /// `pledgeDeadline`. Queda registrado por bodega, no es anónimo.
    function pledge(uint256 id) external payable {
        GroupOrder storage order = groupOrders[id];
        if (order.organizer == address(0)) revert OrderNotFound();
        if (!bodegaRegistry.isBodega(msg.sender)) revert NotABodega();
        if (msg.value == 0) revert ZeroAmount();
        if (block.timestamp > order.pledgeDeadline) revert PledgingClosed();

        pledges[id][msg.sender] += msg.value;
        order.pledged += msg.value;

        emit Pledged(id, msg.sender, msg.value, order.pledged);
    }

    /// @notice La organizadora retira el fondo completo para comprarle al distribuidor.
    /// Requiere que ya haya cerrado el período de aportes, que se haya alcanzado `goal`, y
    /// que todavía esté dentro de `withdrawWindowSeconds`.
    function withdraw(uint256 id) external {
        GroupOrder storage order = groupOrders[id];
        if (order.organizer == address(0)) revert OrderNotFound();
        if (order.organizer != msg.sender) revert NotOrganizer();
        if (order.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp <= order.pledgeDeadline) revert NotYetDue();
        if (order.pledged < order.goal) revert GoalNotReached();
        if (block.timestamp > uint256(order.pledgeDeadline) + order.withdrawWindowSeconds) revert WithdrawWindowExpired();

        order.withdrawn = true;
        uint256 amount = order.pledged;

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "withdraw transfer failed");

        emit Withdrawn(id, msg.sender, amount);
    }

    /// @notice Cualquier bodega que aportó reclama su parte de vuelta, en dos escenarios: el
    /// pedido nunca alcanzó `goal` (una vez cerrado el período de aportes), o sí lo alcanzó
    /// pero la organizadora dejó vencer `withdrawWindowSeconds` sin retirar. `order.pledged`
    /// nunca se descuenta acá a propósito — es el registro histórico de cuánto se juntó en
    /// total, usado para decidir si el pedido "alcanzó la meta"; lo que sí se pone en cero es
    /// el aporte individual de quien reclama, para que no pueda reembolsarse dos veces.
    function refund(uint256 id) external {
        GroupOrder storage order = groupOrders[id];
        if (order.organizer == address(0)) revert OrderNotFound();

        uint256 amount = pledges[id][msg.sender];
        if (amount == 0) revert NothingToRefund();

        bool goalFailed = block.timestamp > order.pledgeDeadline && order.pledged < order.goal;
        bool withdrawExpired =
            order.pledged >= order.goal && !order.withdrawn && block.timestamp > uint256(order.pledgeDeadline) + order.withdrawWindowSeconds;
        if (!goalFailed && !withdrawExpired) revert NotYetRefundable();

        pledges[id][msg.sender] = 0;

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "refund transfer failed");

        emit Refunded(id, msg.sender, amount);
    }
}
