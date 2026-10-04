import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { isAddress } from "viem";
import { setIfNotExists } from "@/lib/kv";
import { clientIp, hitRateLimit } from "@/lib/rateLimit";
import { verifyAttestation } from "@/lib/zkOracle";

/**
 * Runs the actual ZK proving (snarkjs.groth16.fullProve) server-side — the wasm witness
 * calculator + zkey proving key together are several MB, no reason to ship them to a
 * bodeguero's phone. Takes the attestation from /api/credit-certificate/attest (the score
 * stays private input here — this route is the only place besides `attest` that ever sees
 * it) and returns the proof already formatted as CreditCertificate.submitCertificate's
 * calldata shape.
 *
 * Proving is CPU-heavy, so before running it this route: limits calls per IP, checks the
 * attestation's EdDSA signature against our own oracle key (made-up inputs are rejected without
 * proving), and only proves each attestation once — so the number of proofs is bounded by the
 * number of attestations /attest hands out, which is rate limited too.
 */
const PER_IP_HOURLY_LIMIT = 10;
const HOUR_SECONDS = 60 * 60;
/**
 * The app proves right after /attest, so 15 minutes is plenty — stricter than the 1 hour
 * CreditCertificate.sol accepts, leaving most of that hour to submit the proof on-chain.
 */
const MAX_ATTESTATION_AGE_SECONDS = 15 * 60;
const DECIMAL = /^\d{1,80}$/;
const wasmPath = path.join(process.cwd(), "circuits", "creditCertificate.wasm");
const zkeyPath = path.join(process.cwd(), "circuits", "creditCertificate.zkey");

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { bodegaAddress, threshold, score, issuedAt, R8x, R8y, S, oracleAx, oracleAy } = body ?? {};

  const numericFields = [threshold, score, issuedAt, R8x, R8y, S, oracleAx, oracleAy].map((v) => String(v ?? ""));
  if (typeof bodegaAddress !== "string" || !isAddress(bodegaAddress) || !numericFields.every((v) => DECIMAL.test(v))) {
    return NextResponse.json({ error: "missing or malformed attestation fields" }, { status: 400 });
  }
  if (!process.env.ZK_ORACLE_PRIVATE_KEY) {
    return NextResponse.json({ error: "credit-certificate service not configured" }, { status: 503 });
  }

  if (await hitRateLimit(`zk-prove:ip:${clientIp(request)}`, PER_IP_HOURLY_LIMIT, HOUR_SECONDS)) {
    return NextResponse.json({ error: "too many requests, try again later", reason: "rate_limited" }, { status: 429 });
  }

  // Cheap checks first: a proof can't succeed if these fail, so don't spend CPU finding out.
  if (BigInt(score) < BigInt(threshold)) {
    return NextResponse.json({ error: "score does not clear the requested threshold" }, { status: 400 });
  }
  if (Math.floor(Date.now() / 1000) - Number(issuedAt) > MAX_ATTESTATION_AGE_SECONDS) {
    return NextResponse.json({ error: "attestation expired, request a new one" }, { status: 400 });
  }
  const attestation = {
    score: String(score),
    issuedAt: String(issuedAt),
    R8x: String(R8x),
    R8y: String(R8y),
    S: String(S),
    oracleAx: String(oracleAx),
    oracleAy: String(oracleAy),
  };
  if (!(await verifyAttestation(BigInt(bodegaAddress), attestation))) {
    return NextResponse.json({ error: "attestation was not signed by this oracle" }, { status: 401 });
  }
  if (!(await setIfNotExists(`zk-prove:used:${S}`, "1", MAX_ATTESTATION_AGE_SECONDS))) {
    return NextResponse.json({ error: "attestation already used, request a new one" }, { status: 409 });
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
