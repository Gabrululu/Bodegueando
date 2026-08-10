import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

// Plain script instead of node:test — `node --test` with process isolation hung
// indefinitely here (stuck in epoll with near-zero CPU) when loading the wasm witness
// calculator, likely an interaction between its per-file subprocess model and snarkjs'
// WASM loading. This runs the same assertions sequentially with plain asserts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../build/creditCertificate_js/creditCertificate.wasm");
const zkeyPath = path.join(__dirname, "../build/creditCertificate_final.zkey");
const vkeyPath = path.join(__dirname, "../build/verification_key.json");

async function buildInput({ eddsa, poseidon, prvKey, bodega, score, threshold, issuedAt }) {
  const F = poseidon.F;
  const msg = poseidon([bodega, score, issuedAt]);
  const signature = eddsa.signPoseidon(prvKey, msg);
  const pubKey = eddsa.prv2pub(prvKey);
  return {
    score: score.toString(),
    R8x: F.toObject(signature.R8[0]).toString(),
    R8y: F.toObject(signature.R8[1]).toString(),
    S: signature.S.toString(),
    threshold: threshold.toString(),
    bodega: bodega.toString(),
    oracleAx: F.toObject(pubKey[0]).toString(),
    oracleAy: F.toObject(pubKey[1]).toString(),
    issuedAt: issuedAt.toString(),
  };
}

async function run() {
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const prvKey = Buffer.from("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
  const wrongPrvKey = Buffer.from("ff02030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");

  // 1. Firma válida y score >= threshold: la prueba se genera y verifica, y los
  //    publicSignals nunca exponen el score privado.
  {
    const input = await buildInput({ eddsa, poseidon, prvKey, bodega: 12345n, score: 750n, threshold: 700n, issuedAt: 1700000000n });
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    assert.equal(publicSignals.length, 5);
    assert.equal(publicSignals[0], "700");
    assert.equal(publicSignals[1], "12345");
    assert.ok(!publicSignals.includes("750"), "el score privado no debe aparecer en las señales públicas");
    const vKey = JSON.parse(await readFile(vkeyPath, "utf-8"));
    const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    assert.equal(ok, true);
    console.log("✓ firma válida + score >= threshold produce una prueba válida");
  }

  // 2. Score por debajo del threshold: la restricción GreaterEqThan no se satisface,
  //    la generación del witness debe fallar (no se puede fabricar una prueba falsa).
  {
    const input = await buildInput({ eddsa, poseidon, prvKey, bodega: 12345n, score: 650n, threshold: 700n, issuedAt: 1700000000n });
    await assert.rejects(() => snarkjs.groth16.fullProve(input, wasmPath, zkeyPath));
    console.log("✓ score < threshold no puede generar una prueba");
  }

  // 3. Firma de una key distinta a la reclamada como oráculo: EdDSAPoseidonVerifier
  //    tampoco deja generar el witness.
  {
    const F = poseidon.F;
    const msg = poseidon([12345n, 750n, 1700000000n]);
    const signature = eddsa.signPoseidon(wrongPrvKey, msg);
    const realPubKey = eddsa.prv2pub(prvKey);
    const input = {
      score: "750",
      R8x: F.toObject(signature.R8[0]).toString(),
      R8y: F.toObject(signature.R8[1]).toString(),
      S: signature.S.toString(),
      threshold: "700",
      bodega: "12345",
      oracleAx: F.toObject(realPubKey[0]).toString(),
      oracleAy: F.toObject(realPubKey[1]).toString(),
      issuedAt: "1700000000",
    };
    await assert.rejects(() => snarkjs.groth16.fullProve(input, wasmPath, zkeyPath));
    console.log("✓ firma de una key incorrecta no puede generar una prueba");
  }

  console.log("\nTodos los tests del circuito pasaron.");
  // Algo dentro de snarkjs/circomlibjs (worker threads del WASM) deja el event loop vivo —
  // salida explícita para que el proceso termine.
  process.exit(0);
}

run().catch((err) => {
  console.error("FALLÓ:", err);
  process.exit(1);
});
