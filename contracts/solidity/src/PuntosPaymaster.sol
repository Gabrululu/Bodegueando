// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BasePaymaster} from "account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — same narrow
/// interface InvoiceEscrow.sol/RewardsCatalog.sol/GroupOrders.sol/BeneficioToken.sol each
/// declare locally.
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

/// @notice ERC-4337 paymaster that lets a Bodegueando smart account pay gas with its own
/// PUNTOS (cashback) balance instead of holding native ETH.
///
/// Two ways an account avoids paying PUNTOS for gas, checked in this order:
///
/// 1. It's a registered bodega (`bodegaRegistry.isBodega`) — ALWAYS sponsored, forever, no
///    PUNTOS ever charged. A bodega only earns PUNTOS once (PaymentRouter's registration
///    bootstrap mint) — it never gets ongoing cashback the way a buyer does (only the payer
///    of receivePayment earns cashback), so making it pay its own gas from that one-time mint
///    would eventually strand it. Bodegas also take gas-costing actions far less often than
///    buyers make purchases (toggle fiado once, extend fiado occasionally, create a reward or
///    group order now and then) — low volume, so sponsoring it outright is cheap in practice
///    and matches the project's core promise ("Modelo de negocio" in the README): a bodega
///    never pays anything for its own basic activity, full stop, no PUNTOS balance to manage
///    or run out of.
/// 2. It hasn't used up its first FREE_TRANSACTIONS sponsored UserOperations yet — a runway
///    for the cold-start case where an account's first few actions aren't purchases (paying
///    back fiado, redeeming a reward — neither mints cashback).
///
/// After that, gas is charged in PUNTOS **best-effort, never as a gate**: validation always
/// accepts the operation, and `postOp` charges `min(gas cost in PUNTOS, balance, allowance)`;
/// the platform covers any shortfall (emitted as `GasShortfallSponsored`, so that cost is
/// measurable). Measured live on Arbitrum Sepolia, a payment costs ~US$ 0.05 of gas while the 2%
/// cashback of a S/5 purchase is ~US$ 0.03 — demanding the operation's *maximum* cost up front
/// (the previous design) stranded buyers with small purchases behind a balance wall, which breaks
/// the product's promise that paying never involves thinking about a "network fee". This matches
/// the business model (README, "Modelo de negocio"): operating gas is a platform cost; PUNTOS
/// offset it when the buyer has them.
///
/// PaymentRouter mints PUNTOS in USD-wei
/// (1e18 PUNTOS = 1 USD of cashback, from USDG payments), while gas is paid in ETH, so the
/// charge is converted at `puntosPerEth` — an owner-maintained ETH/USD rate, bounded to
/// [MIN_PUNTOS_PER_ETH, MAX_PUNTOS_PER_ETH] so a bad update can't make gas absurdly cheap or
/// expensive. It's an owner-set value on purpose, not a live oracle read: ERC-4337 bans a
/// paymaster's validation from reading storage of unrelated contracts (ERC-7562), and gas
/// costs are fractions of a cent on Arbitrum, so a rate a few percent stale is immaterial.
/// Whatever the rate, an account is never charged more than the PUNTOS allowance it granted, nor
/// more than its balance.
///
/// The contract itself must hold real ETH (deposited into the EntryPoint via the inherited
/// `deposit()`/`addStake()` from BasePaymaster) to actually pay the bundler/network — PUNTOS
/// collected here are the *accounting* side of "the user paid for their gas", not the ETH
/// itself. See README for how that ETH deposit is funded and replenished.
contract PuntosPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    enum ChargeMode {
        SponsoredBodega,
        FreeTransaction,
        Chargeable
    }

    IERC20 public immutable puntosToken;

    /// @notice NOT immutable, on purpose: PaymentRouter has already been redeployed several
    /// times in this project's history (each one resets its isBodega registry), and
    /// InvoiceEscrow/RewardsCatalog/GroupOrders/CreditLine all learned that lesson the hard
    /// way by hardcoding this as immutable — a future PaymentRouter redeploy would silently
    /// leave them recognizing only bodegas registered on the OLD router. This one can be
    /// repointed with setBodegaRegistry instead of needing its own redeploy every time.
    IBodegaRegistry public bodegaRegistry;

    /// @notice How many sponsored UserOperations a non-bodega account gets free before gas
    /// starts getting pulled from its PUNTOS balance.
    uint256 public constant FREE_TRANSACTIONS = 5;

    /// @notice PUNTOS (USD-wei) charged per 1 ETH of gas, i.e. the ETH/USD price with 18
    /// decimals. 2500e18 means 1 ETH of gas costs 2500 PUNTOS.
    uint256 public puntosPerEth;

    uint256 public constant MIN_PUNTOS_PER_ETH = 100 ether;
    uint256 public constant MAX_PUNTOS_PER_ETH = 100_000 ether;

    /// @notice Gas `postOp` itself spends, which the EntryPoint can't include in the
    /// `actualGasCost` it passes in. Measured on Arbitrum Sepolia (a charged payment came out
    /// ~40k gas short of its real cost); added so the charge reflects what the operation cost.
    uint256 public constant POST_OP_OVERHEAD_GAS = 40_000;

    /// @notice How many of its free transactions an account has already used (successfully).
    mapping(address => uint256) public freeTransactionsUsed;

    error PuntosPerEthOutOfBounds();

    event GasChargedInPuntos(address indexed account, uint256 amount);
    /// @notice Part of an operation's gas the account couldn't cover in PUNTOS — the platform's cost.
    event GasShortfallSponsored(address indexed account, uint256 shortfallPuntos);
    event FreeTransactionUsed(address indexed account, uint256 remaining);
    event GasSponsoredForBodega(address indexed bodega);
    event PuntosSwept(address indexed to, uint256 amount);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);
    event PuntosPerEthUpdated(uint256 puntosPerEth);

    constructor(
        IEntryPoint _entryPoint,
        IERC20 _puntosToken,
        IBodegaRegistry _bodegaRegistry,
        address _owner,
        uint256 _puntosPerEth
    ) BasePaymaster(_entryPoint) {
        puntosToken = _puntosToken;
        bodegaRegistry = _bodegaRegistry;
        _setPuntosPerEth(_puntosPerEth);
        _transferOwnership(_owner);
    }

    /// @notice PUNTOS an account would be charged for `gasCostWei` of gas at the current rate.
    function gasCostInPuntos(uint256 gasCostWei) public view returns (uint256) {
        return (gasCostWei * puntosPerEth) / 1 ether;
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        address account = userOp.sender;

        if (bodegaRegistry.isBodega(account)) {
            return (abi.encode(account, ChargeMode.SponsoredBodega), 0);
        }

        if (freeTransactionsUsed[account] < FREE_TRANSACTIONS) {
            return (abi.encode(account, ChargeMode.FreeTransaction), 0);
        }

        // No balance/allowance gate here — see the contract doc: postOp charges what it can.
        return (abi.encode(account, ChargeMode.Chargeable), 0);
    }

    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
        internal
        override
    {
        (address account, ChargeMode chargeMode) = abi.decode(context, (address, ChargeMode));

        if (chargeMode == ChargeMode.SponsoredBodega) {
            // Nothing to track or charge — a bodega's gas is unconditionally on the house,
            // every time, not just its first few transactions.
            if (mode == PostOpMode.opSucceeded) emit GasSponsoredForBodega(account);
            return;
        }

        if (chargeMode == ChargeMode.FreeTransaction) {
            // Only burn a free transaction if the account's own call actually succeeded. If
            // it reverted (wrong bodega code, insufficient funds, whatever), the account
            // never got any real use out of it and never earned any PUNTOS from it either —
            // counting it anyway would eat into runway it never benefited from.
            if (mode == PostOpMode.opSucceeded) {
                uint256 used = freeTransactionsUsed[account] + 1;
                freeTransactionsUsed[account] = used;
                emit FreeTransactionUsed(account, FREE_TRANSACTIONS - used);
            }
            return;
        }

        // Charge what the account can pay — capped by its balance and allowance, never a revert:
        // the paymaster already paid the real gas, and the platform covers the rest.
        uint256 available = puntosToken.allowance(account, address(this));
        uint256 balance = puntosToken.balanceOf(account);
        if (balance < available) available = balance;
        uint256 owed = gasCostInPuntos(actualGasCost + POST_OP_OVERHEAD_GAS * actualUserOpFeePerGas);
        uint256 charge = owed > available ? available : owed;

        if (charge > 0) {
            puntosToken.safeTransferFrom(account, address(this), charge);
            emit GasChargedInPuntos(account, charge);
        }
        if (owed > charge) emit GasShortfallSponsored(account, owed - charge);
    }

    /// @notice Owner can sweep PUNTOS collected as gas payment (e.g. to burn them or route
    /// them back into the cashback pool). Doesn't touch the ETH deposit — that's managed via
    /// the inherited withdrawTo().
    function sweepPuntos(address to, uint256 amount) external onlyOwner {
        puntosToken.safeTransfer(to, amount);
        emit PuntosSwept(to, amount);
    }

    /// @notice Repoints the bodega registry after a PaymentRouter redeploy — see the field's
    /// doc for why this exists instead of being set once in the constructor.
    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @notice Updates the ETH/USD rate gas is converted to PUNTOS at. See the contract doc
    /// for why this is owner-maintained rather than read from an oracle during validation.
    function setPuntosPerEth(uint256 _puntosPerEth) external onlyOwner {
        _setPuntosPerEth(_puntosPerEth);
    }

    function _setPuntosPerEth(uint256 _puntosPerEth) internal {
        if (_puntosPerEth < MIN_PUNTOS_PER_ETH || _puntosPerEth > MAX_PUNTOS_PER_ETH) {
            revert PuntosPerEthOutOfBounds();
        }
        puntosPerEth = _puntosPerEth;
        emit PuntosPerEthUpdated(_puntosPerEth);
    }
}
