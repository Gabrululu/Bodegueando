// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFiadoScoring} from "./interfaces/IFiadoScoring.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — same narrow
/// interface BeneficioToken.sol uses, so InvoiceEscrow doesn't need PaymentRouter's whole
/// surface, just "is this address a real bodega?".
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

/// @notice Fiado con garantía parcial: an alternative to FiadoScoring's unsecured
/// `extendFiado` for amounts a bodega doesn't want to lend on trust alone. The customer posts
/// a partial ETH collateral (the same testnet-ETH stand-in for eSol used everywhere else) that
/// this contract holds until the invoice is repaid or its due date passes.
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
/// checks-effects-interactions: invoice state is fully updated before any ETH leaves the
/// contract or FiadoScoring is called, so a malicious bodega/customer contract can't reenter
/// a still-"Active" invoice to double-claim.
contract InvoiceEscrow is Ownable {
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
    error WrongCollateralAmount();
    error NotYetDue();

    event InvoiceProposed(
        uint256 indexed id, address indexed bodega, address indexed customer, uint256 principal, uint256 collateralRequired, uint64 dueDate
    );
    event InvoiceCancelled(uint256 indexed id);
    event InvoiceAccepted(uint256 indexed id, uint256 collateral);
    event InvoiceRepaid(uint256 indexed id, uint256 amount, bool fullyRepaid);
    event InvoiceDefaulted(uint256 indexed id, uint256 claimedByBodega, uint256 refundedToCustomer);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);

    constructor(address initialOwner, IBodegaRegistry _bodegaRegistry, IFiadoScoring _fiadoScoring) Ownable(initialOwner) {
        bodegaRegistry = _bodegaRegistry;
        fiadoScoring = _fiadoScoring;
    }

    /// @notice Repoints the bodega registry after a PaymentRouter redeploy.
    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @notice Bodega proposes a collateral-backed invoice for `customer`. No funds or debt
    /// move yet — the customer still has to accept it.
    function proposeInvoice(address customer, uint256 principal, uint256 collateralRequired, uint64 dueDate) external returns (uint256 id) {
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

    /// @notice Customer accepts a proposed invoice, posting exactly the required collateral
    /// (`msg.value`). Atomically records the real debt on FiadoScoring so it counts toward the
    /// customer's score/history like any other fiado extension.
    function acceptInvoice(uint256 id) external payable {
        Invoice storage inv = invoices[id];
        if (inv.customer != msg.sender) revert NotInvoiceCustomer();
        if (inv.status != Status.Proposed) revert InvalidState();
        if (msg.value != inv.collateral) revert WrongCollateralAmount();

        inv.status = Status.Active;

        fiadoScoring.extendFiadoFor(inv.bodega, inv.customer, inv.principal);

        emit InvoiceAccepted(id, msg.value);
    }

    /// @notice Customer repays this specific invoice (partial payments allowed). Forwards the
    /// ETH to the bodega and records the repayment on FiadoScoring, same as
    /// `PaymentRouter.payFiado` does for unsecured fiado. Once `repaidAmount` reaches
    /// `principal`, the full collateral is returned to the customer.
    function repayInvoice(uint256 id) external payable {
        Invoice storage inv = invoices[id];
        if (inv.customer != msg.sender) revert NotInvoiceCustomer();
        if (inv.status != Status.Active) revert InvalidState();
        if (msg.value == 0) revert ZeroAmount();

        uint256 remaining = inv.principal - inv.repaidAmount;
        uint256 applied = msg.value > remaining ? remaining : msg.value;
        uint256 refund = msg.value - applied;

        inv.repaidAmount += applied;

        bool fullyRepaid = inv.repaidAmount >= inv.principal;
        uint256 collateralToReturn = 0;
        if (fullyRepaid) {
            inv.status = Status.Repaid;
            collateralToReturn = inv.collateral;
            inv.collateral = 0;
        }

        // Interactions last (state above is already final for this call).
        fiadoScoring.repayFiado(inv.bodega, inv.customer, applied);

        (bool sentToBodega,) = payable(inv.bodega).call{value: applied}("");
        require(sentToBodega, "transfer to bodega failed");

        if (collateralToReturn > 0) {
            (bool sentToCustomer,) = payable(inv.customer).call{value: collateralToReturn}("");
            require(sentToCustomer, "collateral refund failed");
        }
        if (refund > 0) {
            (bool sentRefund,) = payable(msg.sender).call{value: refund}("");
            require(sentRefund, "overpayment refund failed");
        }

        emit InvoiceRepaid(id, applied, fullyRepaid);
    }

    /// @notice Bodega claims the collateral after the due date passed with an outstanding
    /// shortfall. Claims at most `min(shortfall, collateral)` — never more than what's actually
    /// still owed — records that amount as a FiadoScoring repayment (the bodega recovered that
    /// value, so the debt ledger reflects it), and returns any leftover collateral to the
    /// customer.
    function claimCollateral(uint256 id) external {
        Invoice storage inv = invoices[id];
        if (inv.bodega != msg.sender) revert NotInvoiceBodega();
        if (inv.status != Status.Active) revert InvalidState();
        if (block.timestamp <= inv.dueDate) revert NotYetDue();

        uint256 shortfall = inv.principal - inv.repaidAmount;
        uint256 claimed = shortfall < inv.collateral ? shortfall : inv.collateral;
        uint256 refund = inv.collateral - claimed;

        inv.status = Status.Defaulted;
        inv.collateral = 0;

        if (claimed > 0) {
            fiadoScoring.repayFiado(inv.bodega, inv.customer, claimed);
            (bool sentToBodega,) = payable(inv.bodega).call{value: claimed}("");
            require(sentToBodega, "collateral claim transfer failed");
        }
        if (refund > 0) {
            (bool sentToCustomer,) = payable(inv.customer).call{value: refund}("");
            require(sentToCustomer, "collateral refund failed");
        }

        emit InvoiceDefaulted(id, claimed, refund);
    }
}
