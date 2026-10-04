// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StablecoinSettlement} from "./StablecoinSettlement.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — same narrow
/// interface BeneficioToken.sol/InvoiceEscrow.sol/RewardsCatalog.sol/GroupOrders.sol each
/// declare locally.
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

interface ICreditCertificate {
    function getCertifiedThreshold(address bodega) external view returns (uint256);
}

/// @notice Línea de crédito on-chain que consume el certificado ZK de CreditCertificate.sol:
/// cuanto más alto el score que una bodega probó (sin revelar la cifra exacta), menos
/// garantía necesita poner para pedir prestado de un pool compartido. Mismo mecanismo de
/// garantía parcial que InvoiceEscrow.sol, solo que acá el tamaño de la garantía lo decide
/// el score certificado, no la bodega.
///
/// Deliberadamente NO es un protocolo de lending completo: interés fijo simple (no curva
/// dinámica), sin oráculo de precio (préstamo, garantía y repago en el mismo stablecoin,
/// USDG, sin riesgo cross-asset), sin instalments (un préstamo se repaga entero de una vez). El default se
/// castiga seizeando la garantía hacia el pool — la consecuencia reputacional (bloquear
/// certificados nuevos mientras haya un default sin resolver) vive en
/// frontend/app/api/credit-certificate/attest/route.ts, no acá, para no tener que acoplar
/// este contrato a CreditCertificate más que en la sola lectura de `getCertifiedThreshold`.
///
/// Contabilidad del pool: el valor de una share es `totalAssets() / totalShares`, donde
/// `totalAssets = poolBalance (líquido) + totalReceivable (principal + interés fijo de los
/// préstamos vivos)`. Contar lo prestado evita que quien retira mientras hay préstamos vivos
/// salga perdiendo; contar también el interés (que es fijo y conocido desde el `borrow`) evita
/// que quien deposita después se quede con parte de un interés que no financió. La pérdida de
/// un default se reconoce al liquidar: lo adeudado sale de `totalReceivable` y solo la
/// garantía entra a `poolBalance`. Las donaciones directas de tokens al contrato no cuentan
/// (solo la contabilidad interna), así que no hay ataque de inflación de shares.
contract CreditLine is Ownable, ReentrancyGuard, StablecoinSettlement {
    using SafeERC20 for IERC20;

    struct Tier {
        uint256 minThreshold;
        uint256 collateralBps;
    }

    struct Loan {
        address bodega;
        uint256 principal;
        uint256 collateral;
        uint256 interestBps;
        uint64 dueDate;
        bool resolved;
    }

    /// @notice NOT immutable, on purpose — see PuntosPaymaster.sol's identical field for why.
    IBodegaRegistry public bodegaRegistry;
    ICreditCertificate public immutable creditCertificate;

    uint256 public constant INTEREST_BPS = 500; // 5% flat por préstamo
    uint64 public constant LOAN_DURATION = 30 days;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    uint256 public totalShares;
    /// @notice Stablecoin líquido en el pool, disponible para prestar o retirar.
    uint256 public poolBalance;
    /// @notice Principal + interés fijo adeudado por préstamos todavía no resueltos.
    uint256 public totalReceivable;
    mapping(address => uint256) public lenderShares;

    uint256 public nextLoanId;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public defaultCount;

    /// @notice Tiers de mayor a menor threshold — el primero cuyo minThreshold la bodega
    /// alcanza define cuánta garantía necesita poner.
    Tier[] public tiers;

    error NotABodega();
    error ZeroAmount();
    error NoCertificate();
    error InsufficientPoolLiquidity();
    error LoanNotFound();
    error NotBorrower();
    error AlreadyResolved();
    error NotYetDue();
    error InsufficientShares();

    event Deposited(address indexed lender, uint256 amount, uint256 shares);
    event Withdrawn(address indexed lender, uint256 shares, uint256 amount);
    event Borrowed(
        uint256 indexed loanId, address indexed bodega, uint256 principal, uint256 collateral, uint256 collateralBps
    );
    event Repaid(uint256 indexed loanId, uint256 amount);
    event Liquidated(uint256 indexed loanId, uint256 collateralSeized);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);

    constructor(
        address initialOwner,
        IBodegaRegistry _bodegaRegistry,
        ICreditCertificate _creditCertificate,
        IERC20 _stablecoin
    ) Ownable(initialOwner) StablecoinSettlement(_stablecoin) {
        bodegaRegistry = _bodegaRegistry;
        creditCertificate = _creditCertificate;

        tiers.push(Tier({minThreshold: 900, collateralBps: 1_500})); // 15%
        tiers.push(Tier({minThreshold: 700, collateralBps: 3_000})); // 30%
        tiers.push(Tier({minThreshold: 500, collateralBps: 5_000})); // 50%
    }

    /// @notice Repoints the bodega registry after a PaymentRouter redeploy.
    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @notice Valor total del pool: líquido + lo adeudado por préstamos vivos.
    function totalAssets() public view returns (uint256) {
        return poolBalance + totalReceivable;
    }

    /// @notice Cualquiera aporta `amount` de stablecoin al pool compartido (requiere approve
    /// previo), a cambio de shares proporcionales a su valor actual — patrón vault simple, sin
    /// ERC-4626 completo.
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        uint256 assets = totalAssets();
        shares = (totalShares == 0 || assets == 0) ? amount : (amount * totalShares) / assets;
        if (shares == 0) revert ZeroAmount();

        totalShares += shares;
        poolBalance += amount;
        lenderShares[msg.sender] += shares;

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Quema `shares` y devuelve su parte del pool. Solo se puede retirar lo que está
    /// líquido: si casi todo está prestado, hay que esperar repagos.
    function withdraw(uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        if (lenderShares[msg.sender] < shares) revert InsufficientShares();

        uint256 amount = (shares * totalAssets()) / totalShares;
        if (amount > poolBalance) revert InsufficientPoolLiquidity();

        lenderShares[msg.sender] -= shares;
        totalShares -= shares;
        poolBalance -= amount;

        stablecoin.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, shares, amount);
    }

    function _collateralBpsFor(address bodega) internal view returns (uint256) {
        uint256 threshold = creditCertificate.getCertifiedThreshold(bodega);
        if (threshold == 0) revert NoCertificate();
        for (uint256 i = 0; i < tiers.length; i++) {
            if (threshold >= tiers[i].minThreshold) return tiers[i].collateralBps;
        }
        revert NoCertificate();
    }

    /// @notice Garantía que `bodega` tendría que poner hoy para pedir `amount` prestado, según
    /// su tier certificado. El frontend la usa para aprobar el monto exacto antes de `borrow`.
    function requiredCollateral(address bodega, uint256 amount) external view returns (uint256) {
        return (amount * _collateralBpsFor(bodega)) / BPS_DENOMINATOR;
    }

    /// @notice Lo que hay que pagar para cerrar `loanId`: principal + interés fijo.
    function amountOwed(uint256 loanId) public view returns (uint256) {
        Loan storage loan = loans[loanId];
        return loan.principal + (loan.principal * loan.interestBps) / BPS_DENOMINATOR;
    }

    /// @notice Bodega registrada con certificado vigente pide prestado `amount` del pool. La
    /// garantía (el % lo determina su tier certificado, no una elección propia — a diferencia
    /// de InvoiceEscrow, donde la bodega elige la garantía que le pide a su cliente) se jala
    /// con transferFrom, así que tiene que estar aprobada antes.
    function borrow(uint256 amount) external nonReentrant returns (uint256 loanId) {
        if (!bodegaRegistry.isBodega(msg.sender)) revert NotABodega();
        if (amount == 0) revert ZeroAmount();
        if (amount > poolBalance) revert InsufficientPoolLiquidity();

        uint256 collateralBps = _collateralBpsFor(msg.sender);
        uint256 collateral = (amount * collateralBps) / BPS_DENOMINATOR;

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            bodega: msg.sender,
            principal: amount,
            collateral: collateral,
            interestBps: INTEREST_BPS,
            dueDate: uint64(block.timestamp) + LOAN_DURATION,
            resolved: false
        });

        poolBalance -= amount;
        totalReceivable += amountOwed(loanId);

        if (collateral > 0) {
            stablecoin.safeTransferFrom(msg.sender, address(this), collateral);
        }
        stablecoin.safeTransfer(msg.sender, amount);

        emit Borrowed(loanId, msg.sender, amount, collateral, collateralBps);
    }

    /// @notice Repaga el préstamo entero (principal + interés fijo) de una vez y recupera
    /// la garantía. Lo repagado vuelve al pool, benefician a todos los lenders vía sus shares.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.bodega == address(0)) revert LoanNotFound();
        if (loan.bodega != msg.sender) revert NotBorrower();
        if (loan.resolved) revert AlreadyResolved();

        uint256 owed = amountOwed(loanId);

        loan.resolved = true;
        uint256 collateralToReturn = loan.collateral;
        loan.collateral = 0;

        totalReceivable -= owed;
        poolBalance += owed;

        stablecoin.safeTransferFrom(msg.sender, address(this), owed);
        if (collateralToReturn > 0) {
            stablecoin.safeTransfer(msg.sender, collateralToReturn);
        }

        emit Repaid(loanId, owed);
    }

    /// @notice Pasado el vencimiento sin repago, cualquiera puede liquidar: la garantía pasa
    /// al pool (compensa a los lenders), lo adeudado deja de contarse como activo (la pérdida
    /// se reconoce acá) y queda registrado el default.
    function liquidate(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.bodega == address(0)) revert LoanNotFound();
        if (loan.resolved) revert AlreadyResolved();
        if (block.timestamp <= loan.dueDate) revert NotYetDue();

        loan.resolved = true;
        uint256 seized = loan.collateral;
        loan.collateral = 0;

        totalReceivable -= amountOwed(loanId);
        poolBalance += seized;
        defaultCount[loan.bodega]++;

        emit Liquidated(loanId, seized);
    }

    function getDefaultCount(address bodega) external view returns (uint256) {
        return defaultCount[bodega];
    }

    function tiersLength() external view returns (uint256) {
        return tiers.length;
    }
}
