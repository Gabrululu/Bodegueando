// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Interface matching the Groth16 verifier snarkjs autogenerates
/// (`CreditCertificateVerifier.sol`, contract `Groth16Verifier`) — declared separately so
/// tests can swap in a mock without needing a real proof.
interface IGroth16Verifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata publicSignals)
        external
        view
        returns (bool);
}

/// @notice Certificado de crédito con Zero-Knowledge: una bodega prueba "mi score en
/// FiadoScoring es >= threshold" sin revelar el score exacto. La prueba viene del circuito
/// en contracts/circom-credit-certificate/circuits/creditCertificate.circom — este contrato
/// solo valida esa prueba (delegando la criptografía al verificador autogenerado por
/// snarkjs, `Groth16Verifier` en CreditCertificateVerifier.sol) y guarda el resultado.
///
/// El score en sí ya es público on-chain (`FiadoScoring.getScore`) — lo que este certificado
/// agrega no es ocultar un dato secreto, es una credencial portable y verificable ("score >=
/// 700" en vez de la cifra exacta) que un banco puede validar sin entender los contratos de
/// Bodegueando, y que además otros contratos (ver CreditLine.sol) pueden consumir on-chain.
///
/// La atadura de confianza es el oráculo: firma `poseidon(bodega, score, issuedAt)` con una
/// key EdDSA-BabyJubJub dedicada (distinta de `ai_oracle`, que es secp256k1 y no sirve para
/// verificar barato dentro de un circuito) — mismo nivel de confianza que `ai_oracle` ya
/// tiene en FiadoScoring, solo que acá la firma se verifica dentro de la prueba en vez de
/// simplemente confiar en quién mandó la transacción.
contract CreditCertificate is Ownable {
    IGroth16Verifier public immutable verifier;

    uint256 public oracleAx;
    uint256 public oracleAy;

    /// @notice Cuánto dura vigente un certificado una vez enviado on-chain.
    uint256 public constant VALIDITY_PERIOD = 30 days;

    /// @notice Cuán vieja puede ser la atestación del oráculo (issuedAt) al momento de
    /// enviarse — evita reusar una firma vieja indefinidamente, aunque el certificado
    /// resultante igual dura VALIDITY_PERIOD una vez aceptado.
    uint256 public constant MAX_ATTESTATION_AGE = 1 hours;

    struct Certificate {
        uint256 threshold;
        uint256 expiresAt;
    }

    mapping(address => Certificate) public certificates;

    error InvalidProof();
    error UntrustedOracle();
    error AttestationTooOld();
    error AttestationInFuture();
    error ZeroPubKey();

    event OraclePubKeyUpdated(uint256 ax, uint256 ay);
    event CertificateSubmitted(address indexed bodega, uint256 threshold, uint256 expiresAt);

    constructor(address initialOwner, IGroth16Verifier _verifier) Ownable(initialOwner) {
        verifier = _verifier;
    }

    function setOraclePubKey(uint256 ax, uint256 ay) external onlyOwner {
        if (ax == 0 && ay == 0) revert ZeroPubKey();
        oracleAx = ax;
        oracleAy = ay;
        emit OraclePubKeyUpdated(ax, ay);
    }

    /// @notice `publicSignals` = [threshold, bodega, oracleAx, oracleAy, issuedAt] — mismo
    /// orden que declara `component main {public [...]}` en creditCertificate.circom.
    function submitCertificate(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata publicSignals)
        external
    {
        uint256 threshold = publicSignals[0];
        address bodega = address(uint160(publicSignals[1]));
        uint256 ax = publicSignals[2];
        uint256 ay = publicSignals[3];
        uint256 issuedAt = publicSignals[4];

        if (ax != oracleAx || ay != oracleAy) revert UntrustedOracle();
        if (issuedAt > block.timestamp) revert AttestationInFuture();
        if (block.timestamp - issuedAt > MAX_ATTESTATION_AGE) revert AttestationTooOld();
        if (!verifier.verifyProof(a, b, c, publicSignals)) revert InvalidProof();

        uint256 expiresAt = block.timestamp + VALIDITY_PERIOD;
        certificates[bodega] = Certificate({threshold: threshold, expiresAt: expiresAt});
        emit CertificateSubmitted(bodega, threshold, expiresAt);
    }

    /// @notice `threshold` vigente de `bodega`, o 0 si nunca certificó o venció. Es lo que
    /// consulta CreditLine.sol (y cualquier verificador externo) para saber si confiar.
    function getCertifiedThreshold(address bodega) external view returns (uint256) {
        Certificate memory cert = certificates[bodega];
        if (block.timestamp > cert.expiresAt) return 0;
        return cert.threshold;
    }
}
