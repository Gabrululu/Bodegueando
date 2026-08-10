// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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
/// dinámica), sin oráculo de precio (todo en la misma moneda eSol/ETH, sin riesgo
/// cross-asset), sin instalments (un préstamo se repaga entero de una vez). El default se
/// castiga seizeando la garantía hacia el pool — la consecuencia reputacional (bloquear
/// certificados nuevos mientras haya un default sin resolver) vive en
/// frontend/app/api/credit-certificate/attest/route.ts, no acá, para no tener que acoplar
/// este contrato a CreditCertificate más que en la sola lectura de `getCertifiedThreshold`.
contract CreditLine {
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

    IBodegaRegistry public immutable bodegaRegistry;
    ICreditCertificate public immutable creditCertificate;

    uint256 public constant INTEREST_BPS = 500; // 5% flat por préstamo
    uint64 public constant LOAN_DURATION = 30 days;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    uint256 public totalShares;
    uint256 public poolBalance;
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
    error WrongCollateralAmount();
    error WrongRepayAmount();
    error InsufficientPoolLiquidity();
    error LoanNotFound();
    error NotBorrower();
    error AlreadyResolved();
    error NotYetDue();
    error InsufficientShares();

    event Deposited(address indexed lender, uint256 amount, uint256 shares);
    event Withdrawn(address indexed lender, uint256 shares, uint256 amount);
    event Borrowed(uint256 indexed loanId, address indexed bodega, uint256 principal, uint256 collateral, uint256 collateralBps);
    event Repaid(uint256 indexed loanId, uint256 amount);
    event Liquidated(uint256 indexed loanId, uint256 collateralSeized);

    constructor(IBodegaRegistry _bodegaRegistry, ICreditCertificate _creditCertificate) {
        bodegaRegistry = _bodegaRegistry;
        creditCertificate = _creditCertificate;

        tiers.push(Tier({minThreshold: 900, collateralBps: 1_500})); // 15%
        tiers.push(Tier({minThreshold: 700, collateralBps: 3_000})); // 30%
        tiers.push(Tier({minThreshold: 500, collateralBps: 5_000})); // 50%
    }

    /// @notice Cualquiera aporta ETH al pool compartido, a cambio de shares proporcionales
    /// a su valor actual — patrón vault simple, sin ERC-4626 completo.
    function deposit() external payable returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        shares = totalShares == 0 ? msg.value : (msg.value * totalShares) / poolBalance;

        totalShares += shares;
        poolBalance += msg.value;
        lenderShares[msg.sender] += shares;

        emit Deposited(msg.sender, msg.value, shares);
    }

    function withdraw(uint256 shares) external {
        if (shares == 0) revert ZeroAmount();
        if (lenderShares[msg.sender] < shares) revert InsufficientShares();

        uint256 amount = (shares * poolBalance) / totalShares;

        lenderShares[msg.sender] -= shares;
        totalShares -= shares;
        poolBalance -= amount;

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "withdraw transfer failed");

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

    /// @notice Bodega registrada con certificado vigente pide prestado `amount` del pool,
    /// posting `msg.value` como garantía — el % exacto lo determina su tier certificado, no
    /// una elección propia (a diferencia de InvoiceEscrow, donde la bodega elige la
    /// garantía que le pide a su cliente).
    function borrow(uint256 amount) external payable returns (uint256 loanId) {
        if (!bodegaRegistry.isBodega(msg.sender)) revert NotABodega();
        if (amount == 0) revert ZeroAmount();
        if (amount > poolBalance) revert InsufficientPoolLiquidity();

        uint256 collateralBps = _collateralBpsFor(msg.sender);
        uint256 requiredCollateral = (amount * collateralBps) / BPS_DENOMINATOR;
        if (msg.value != requiredCollateral) revert WrongCollateralAmount();

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            bodega: msg.sender,
            principal: amount,
            collateral: msg.value,
            interestBps: INTEREST_BPS,
            dueDate: uint64(block.timestamp) + LOAN_DURATION,
            resolved: false
        });

        poolBalance -= amount;

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "loan transfer failed");

        emit Borrowed(loanId, msg.sender, amount, msg.value, collateralBps);
    }

    /// @notice Repaga el préstamo entero (principal + interés fijo) de una vez y recupera
    /// la garantía. Lo repagado vuelve al pool, benefician a todos los lenders vía sus shares.
    function repay(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        if (loan.bodega == address(0)) revert LoanNotFound();
        if (loan.bodega != msg.sender) revert NotBorrower();
        if (loan.resolved) revert AlreadyResolved();

        uint256 owed = loan.principal + (loan.principal * loan.interestBps) / BPS_DENOMINATOR;
        if (msg.value != owed) revert WrongRepayAmount();

        loan.resolved = true;
        uint256 collateralToReturn = loan.collateral;
        loan.collateral = 0;

        poolBalance += msg.value;

        (bool sentCollateral,) = payable(msg.sender).call{value: collateralToReturn}("");
        require(sentCollateral, "collateral refund failed");

        emit Repaid(loanId, msg.value);
    }

    /// @notice Pasado el vencimiento sin repago, cualquiera puede liquidar: la garantía pasa
    /// al pool (compensa a los lenders) y queda registrado el default.
    function liquidate(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.bodega == address(0)) revert LoanNotFound();
        if (loan.resolved) revert AlreadyResolved();
        if (block.timestamp <= loan.dueDate) revert NotYetDue();

        loan.resolved = true;
        uint256 seized = loan.collateral;
        loan.collateral = 0;

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
