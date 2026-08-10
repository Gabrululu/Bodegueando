import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import * as snarkjs from "snarkjs";

/**
 * Runs the actual ZK proving (snarkjs.groth16.fullProve) server-side — the wasm witness
 * calculator + zkey proving key together are several MB, no reason to ship them to a
 * bodeguero's phone. Takes the attestation from /api/credit-certificate/attest (the score
 * stays private input here — this route is the only place besides `attest` that ever sees
 * it) and returns the proof already formatted as CreditCertificate.submitCertificate's
 * calldata shape.
 */
const wasmPath = path.join(process.cwd(), "circuits", "creditCertificate.wasm");
const zkeyPath = path.join(process.cwd(), "circuits", "creditCertificate.zkey");

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { bodegaAddress, threshold, score, issuedAt, R8x, R8y, S, oracleAx, oracleAy } = body ?? {};

  if (!bodegaAddress || !threshold || !score || !issuedAt || !R8x || !R8y || !S || !oracleAx || !oracleAy) {
    return NextResponse.json({ error: "missing attestation fields" }, { status: 400 });
  }

  const input = {
    score: String(score),
    R8x: String(R8x),
    R8y: String(R8y),
    S: String(S),
    threshold: String(threshold),
    bodega: BigInt(bodegaAddress).toString(),
    oracleAx: String(oracleAx),
    oracleAy: String(oracleAy),
    issuedAt: String(issuedAt),
  };

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [a, b, c, publicSignalsOut] = JSON.parse(`[${calldata}]`);
    return NextResponse.json({ a, b, c, publicSignals: publicSignalsOut });
  } catch {
    return NextResponse.json({ error: "could not generate proof — attestation may not satisfy score >= threshold" }, { status: 400 });
  }
}
