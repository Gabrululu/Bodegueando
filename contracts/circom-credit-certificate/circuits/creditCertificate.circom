pragma circom 2.0.0;

include "poseidon.circom";
include "eddsaposeidon.circom";
include "comparators.circom";

/// @notice Prueba "el oráculo firmó este score para esta bodega, y ese score >= threshold"
/// sin revelar el score exacto. `score` y la firma EdDSA son privados; todo lo demás
/// (threshold, bodega, pubkey del oráculo, issuedAt) es público — son exactamente los datos
/// que CreditCertificate.sol necesita para validar y registrar el certificado on-chain.
///
/// El mensaje firmado por el oráculo es poseidon(bodega, score, issuedAt) — mismo hash que
/// frontend/app/api/credit-certificate/attest/route.ts calcula antes de firmar, y que
/// EdDSAPoseidonVerifier verifica acá adentro.
template CreditCertificate() {
    signal input score;
    signal input R8x;
    signal input R8y;
    signal input S;

    signal input threshold;
    signal input bodega;
    signal input oracleAx;
    signal input oracleAy;
    signal input issuedAt;

    component msgHash = Poseidon(3);
    msgHash.inputs[0] <== bodega;
    msgHash.inputs[1] <== score;
    msgHash.inputs[2] <== issuedAt;

    component sigVerify = EdDSAPoseidonVerifier();
    sigVerify.enabled <== 1;
    sigVerify.Ax <== oracleAx;
    sigVerify.Ay <== oracleAy;
    sigVerify.R8x <== R8x;
    sigVerify.R8y <== R8y;
    sigVerify.S <== S;
    sigVerify.M <== msgHash.out;

    // El score de FiadoScoring va de 0 a 1000 — 16 bits alcanza sobra.
    component gte = GreaterEqThan(16);
    gte.in[0] <== score;
    gte.in[1] <== threshold;
    gte.out === 1;
}

component main {public [threshold, bodega, oracleAx, oracleAy, issuedAt]} = CreditCertificate();
