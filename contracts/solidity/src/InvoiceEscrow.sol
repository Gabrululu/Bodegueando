// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFiadoScoring} from "./interfaces/IFiadoScoring.sol";
import {StablecoinSettlement} from "./StablecoinSettlement.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — same narrow
/// interface BeneficioToken.sol uses, so InvoiceEscrow doesn't need PaymentRouter's whole
/// surface, just "is this address a real bodega?".
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

/// @notice Fiado con garantía parcial: an alternative to FiadoScoring's unsecured
/// `extendFiado` for amounts a bodega doesn't want to lend on trust alone. The customer posts
/// a partial collateral in the settlement stablecoin (USDG) that this contract holds until the
/// invoice is repaid or its due date passes. Principal, collateral and repayments are stored
/// in stablecoin decimals; what's recorded on FiadoScoring is normalized to USD-wei, the same
/// unit PaymentRouter records unsecured fiado in.
///
/// This does NOT replace `extendFiado` — a bodega can keep fiar-ing small amounts unsecured
/// exactly as before. It's a second path for larger amounts, and it feeds the SAME debt ledger:
/// `acceptInvoice` calls `FiadoScoring.extendFiadoFor` (escrow-gated) so collateral-backed debt
/// counts toward a customer's score/history exactly like ordinary fiado does.
///
/// Lifecycle: Proposed (bodega proposes, no funds/debt yet) -> Active (customer accepted,
/// posted collateral, debt recorded) -> Repaid (principal fully paid back, collateral
/// returned) or Defaulted (due date passed with a shortfall still owed, bodega claimed the
/// collateral to cover it, any leftover returned to the customer).
///
/// Any address can be `bodega` here as long as `bodegaRegistry.isBodega` says so — including
/// self-registered ones (`PaymentRouter.registerSelf`) — so every external transfer follows
/// checks-effects-interactions (invoice state is fully updated before any token moves or
/// FiadoScoring is called) and every fund-moving function is also `nonReentrant`, as a second
/// line of defense in case the stablecoin ever gains transfer hooks.
contract InvoiceEscrow is Ownable, ReentrancyGuard, StablecoinSettlement {
    using SafeERC20 for IERC20;

    enum Status {
        Proposed,
        Active,
        Repaid,
        Defaulted,
        Cancelled
    }

    struct Invoice {
        address bodega;
        address customer;
        uint256 principal;
        uint256 collateral;
        uint256 repaidAmount;
        uint64 dueDate;
        Status status;
    }

    /// @notice NOT immutable, on purpose — see PuntosPaymaster.sol's identical field for why:
    /// PaymentRouter has already been redeployed several times in this project (each reset
    /// resets its isBodega registry), and this used to be hardcoded immutable here, which
    /// would leave InvoiceEscrow silently blind to bodegas registered after the next
    /// redeploy. setBodegaRegistry (owner-only) repoints it instead.
    IBodegaRegistry public bodegaRegistry;
    IFiadoScoring public immutable fiadoScoring;

    uint256 public nextInvoiceId;
    mapping(uint256 => Invoice) public invoices;

    error NotABodega();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidDueDate();
    error NotInvoiceBodega();
    error NotInvoiceCustomer();
    error InvalidState();
    error NotYetDue();

    event InvoiceProposed(
        uint256 indexed id,
        address indexed bodega,
        address indexed customer,
        uint256 principal,
        uint256 collateralRequired,
        uint64 dueDate
    );
    event InvoiceCancelled(uint256 indexed id);
    event InvoiceAccepted(uint256 indexed id, uint256 collateral);
    event InvoiceRepaid(uint256 indexed id, uint256 amount, bool fullyRepaid);
    event InvoiceDefaulted(uint256 indexed id, uint256 claimedByBodega, uint256 refundedToCustomer);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);

    constructor(address initialOwner, IBodegaRegistry _bodegaRegistry, IFiadoScoring _fiadoScoring, IERC20 _stablecoin)
        Ownable(initialOwner)
        StablecoinSettlement(_stablecoin)
    {
        bodegaRegistry = _bodegaRegistry;
        fiadoScoring = _fiadoScoring;
    }

    /// @notice Repoints the bodega registry after a PaymentRouter redeploy.
    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @notice Bodega proposes a collateral-backed invoice for `customer`. No funds or debt
    /// move yet — the customer still has to accept it. Amounts are in stablecoin decimals.
    function proposeInvoice(address customer, uint256 principal, uint256 collateralRequired, uint64 dueDate)
        external
        returns (uint256 id)
    {
        if (!bodegaRegistry.isBodega(msg.sender)) revert NotABodega();
        if (customer == address(0)) revert ZeroAddress();
        if (principal == 0) revert ZeroAmount();
        if (dueDate <= block.timestamp) revert InvalidDueDate();

        id = nextInvoiceId++;
        invoices[id] = Invoice({
            bodega: msg.sender,
            customer: customer,
            principal: principal,
            collateral: collateralRequired,
            repaidAmount: 0,
            dueDate: dueDate,
            status: Status.Proposed
        });

        emit InvoiceProposed(id, msg.sender, customer, principal, collateralRequired, dueDate);
    }

    /// @notice Bodega withdraws a proposal the customer hasn't accepted yet.
    function cancelProposal(uint256 id) external {
        Invoice storage inv = invoices[id];
        if (inv.bodega != msg.sender) revert NotInvoiceBodega();
        if (inv.status != Status.Proposed) revert InvalidState();

        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    /// @notice Customer accepts a proposed invoice, posting the required collateral (pulled
    /// via transferFrom, so it must be approved first). Atomically records the real debt on
    /// FiadoScoring so it counts toward the customer's score/history like any other fiado.
    function acceptInvoice(uint256 id) external nonReentrant {
        Invoice storage inv = invoices[id];
        if (inv.customer != msg.sender) revert NotInvoiceCustomer();
        if (inv.status != Status.Proposed) revert InvalidState();

        inv.status = Status.Active;
        emit InvoiceAccepted(id, inv.collateral);

        if (inv.collateral > 0) {
            stablecoin.safeTransferFrom(msg.sender, address(this), inv.collateral);
        }
        fiadoScoring.extendFiadoFor(inv.bodega, inv.customer, _toUsd18(inv.principal));
    }

    /// @notice Customer repays up to `amount` of this invoice (partial payments allowed; only
    /// what's still owed is pulled, so overpaying is impossible rather than refunded). Goes
    /// straight from the customer to the bodega and is recorded on FiadoScoring, same as
    /// `PaymentRouter.payFiado`. Once `repaidAmount` reaches `principal`, the full collateral
    /// is returned to the customer.
    function repayInvoice(uint256 id, uint256 amount) external nonReentrant {
        Invoice storage inv = invoices[id];
        if (inv.customer != msg.sender) revert NotInvoiceCustomer();
        if (inv.status != Status.Active) revert InvalidState();
        if (amount == 0) revert ZeroAmount();

        uint256 remaining = inv.principal - inv.repaidAmount;
        uint256 applied = amount > remaining ? remaining : amount;

        inv.repaidAmount += applied;

        bool fullyRepaid = inv.repaidAmount >= inv.principal;
        uint256 collateralToReturn = 0;
        if (fullyRepaid) {
            inv.status = Status.Repaid;
            collateralToReturn = inv.collateral;
            inv.collateral = 0;
        }
        emit InvoiceRepaid(id, applied, fullyRepaid);

        // Interactions last (state above is already final for this call).
        stablecoin.safeTransferFrom(msg.sender, inv.bodega, applied);
        fiadoScoring.repayFiado(inv.bodega, inv.customer, _toUsd18(applied));

        if (collateralToReturn > 0) {
            stablecoin.safeTransfer(inv.customer, collateralToReturn);
        }
    }

    /// @notice Bodega claims the collateral after the due date passed with an outstanding
    /// shortfall. Claims at most `min(shortfall, collateral)` — never more than what's actually
    /// still owed — records that amount as a FiadoScoring repayment (the bodega recovered that
    /// value, so the debt ledger reflects it), and returns any leftover collateral to the
    /// customer.
    function claimCollateral(uint256 id) external nonReentrant {
        Invoice storage inv = invoices[id];
        if (inv.bodega != msg.sender) revert NotInvoiceBodega();
        if (inv.status != Status.Active) revert InvalidState();
        if (block.timestamp <= inv.dueDate) revert NotYetDue();

        uint256 shortfall = inv.principal - inv.repaidAmount;
        uint256 claimed = shortfall < inv.collateral ? shortfall : inv.collateral;
        uint256 refund = inv.collateral - claimed;

        inv.status = Status.Defaulted;
        inv.collateral = 0;
        emit InvoiceDefaulted(id, claimed, refund);

        if (claimed > 0) {
            fiadoScoring.repayFiado(inv.bodega, inv.customer, _toUsd18(claimed));
            stablecoin.safeTransfer(inv.bodega, claimed);
        }
        if (refund > 0) {
            stablecoin.safeTransfer(inv.customer, refund);
        }
    }
}
