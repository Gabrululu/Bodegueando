// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal read-only view into PaymentRouter's bodega registry — BeneficioToken only
/// needs to ask "is this address a real bodega?", never the rest of PaymentRouter's surface.
interface IBodegaRegistry {
    function isBodega(address account) external view returns (bool);
}

/// @notice PoC de "beneficio social on-chain": un token restringido para programas como Vaso
/// de Leche, Qali Warma o Pensión 65. A diferencia de PuntosToken (libre, transferible entre
/// cualquiera), BeneficioToken solo se puede gastar en una bodega ya registrada en
/// PaymentRouter — nunca revenderse a otra persona ni cambiarse por efectivo — y cada emisión
/// vence a los `duration` segundos de emitida.
///
/// Por qué esto SÍ es un token restringido de verdad y no una etiqueta: la restricción vive en
/// `_update` (el hook que ERC20 llama en absolutamente toda transferencia, incluida
/// `transferFrom`), así que no hay forma de saltársela usando otra función del token o
/// aprobando a un tercero — cualquier wallet estándar que llame `transfer` ya queda sujeta a
/// las dos reglas.
///
/// Qué NO resuelve esta PoC (a propósito, no por descuido):
/// - No restringe la categoría del gasto ("solo alimentos"). Eso necesitaría un catálogo de
///   productos por bodega, que no existe en el resto de la app — sería simular una
///   funcionalidad que no está ahí, en vez de construirla.
/// - El saldo vencido no se reclama solo de vuelta al programa (necesitaría un keeper/cron
///   on-chain barriendo balances). Simplemente deja de poder gastarse — se queda "congelado"
///   en la wallet del beneficiario, no vuelve al pool automáticamente.
/// Ninguna de las dos es una limitación del contrato en sí: son piezas de otras partes del
/// producto (inventario, automatización off-chain) que no están construidas todavía.
contract BeneficioToken is ERC20, Ownable {
    IBodegaRegistry public bodegaRegistry;

    /// @notice Unix timestamp hasta el que el saldo actual de `beneficiary` se puede gastar.
    /// Cada `issue()` nuevo lo extiende — no es acumulativo por emisión, es un solo
    /// vencimiento por beneficiario (simplificación deliberada, ver doc del contrato).
    mapping(address => uint256) public expiresAt;

    error ZeroAddress();
    error NotABodega();
    error BenefitExpired();

    event BenefitIssued(address indexed beneficiary, uint256 amount, uint256 expiresAt);
    event BenefitRedeemed(address indexed beneficiary, address indexed bodega, uint256 amount);
    event BodegaRegistryUpdated(address indexed bodegaRegistry);

    constructor(address initialOwner, IBodegaRegistry _bodegaRegistry) ERC20("Beneficio Bodegueando", "BENE") Ownable(initialOwner) {
        bodegaRegistry = _bodegaRegistry;
    }

    /// @notice Emite `amount` de beneficio a `beneficiary`, gastable hasta `duration` segundos
    /// desde ahora. Solo el programa (owner) puede emitir — en una integración real sería la
    /// municipalidad o el ministerio correspondiente, con su propia cuenta.
    function issue(address beneficiary, uint256 amount, uint256 duration) external onlyOwner {
        if (beneficiary == address(0)) revert ZeroAddress();
        uint256 newExpiry = block.timestamp + duration;
        expiresAt[beneficiary] = newExpiry;
        _mint(beneficiary, amount);
        emit BenefitIssued(beneficiary, amount, newExpiry);
    }

    function setBodegaRegistry(IBodegaRegistry _bodegaRegistry) external onlyOwner {
        bodegaRegistry = _bodegaRegistry;
        emit BodegaRegistryUpdated(address(_bodegaRegistry));
    }

    /// @dev Runs on every mint, burn and transfer (mint has `from == address(0)`, burn has
    /// `to == address(0)` — both skip the restrictions below, since they're not a spend).
    /// A real transfer must go to a registered bodega, and the sender's benefit must not have
    /// expired yet.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (block.timestamp > expiresAt[from]) revert BenefitExpired();
            if (!bodegaRegistry.isBodega(to)) revert NotABodega();
            emit BenefitRedeemed(from, to, value);
        }
        super._update(from, to, value);
    }
}
