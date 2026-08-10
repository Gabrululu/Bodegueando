import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { fiadoScoringAbi, fiadoScoringAddress, creditLineAbi, creditLineAddress } from "@/lib/contracts";
import { signAttestation, getOraclePubKey } from "@/lib/zkOracle";

/**
 * Reads a bodega's current on-chain score from FiadoScoring (already public — see README
 * "CreditCertificate") and, if it clears the requested threshold, signs
 * poseidon(bodega, score, issuedAt) with the ZK oracle's EdDSA key. The frontend feeds this
 * straight into snarkjs as circuit inputs at /api/credit-certificate/prove — this route never
 * runs the proving itself, just the attestation.
 *
 * Refuses to sign while the bodega has an unresolved default on CreditLine — the
 * reputational consequence of a liquidated loan lives here, not on-chain (see
 * CreditLine.sol's doc comment for why).
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodegaAddress = body?.bodegaAddress;
  const threshold = body?.threshold;

  if (typeof bodegaAddress !== "string" || !isAddress(bodegaAddress)) {
    return NextResponse.json({ error: "bodegaAddress must be a valid address" }, { status: 400 });
  }
  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold <= 0) {
    return NextResponse.json({ error: "threshold must be a positive integer" }, { status: 400 });
  }
  if (!fiadoScoringAddress || !process.env.ZK_ORACLE_PRIVATE_KEY) {
    return NextResponse.json({ error: "credit-certificate service not configured" }, { status: 503 });
  }

  if (creditLineAddress) {
    const defaultCount = (await publicClient.readContract({
      address: creditLineAddress,
      abi: creditLineAbi,
      functionName: "getDefaultCount",
      args: [bodegaAddress as Address],
    })) as bigint;
    if (defaultCount > BigInt(0)) {
      return NextResponse.json({ error: "bodega has an unresolved default on CreditLine — no new certificates" }, { status: 403 });
    }
  }

  const score = (await publicClient.readContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getScore",
    args: [bodegaAddress as Address],
  })) as bigint;

  if (score < BigInt(threshold)) {
    return NextResponse.json({ error: "score does not clear the requested threshold" }, { status: 403 });
  }

  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const attestation = await signAttestation(BigInt(bodegaAddress), score, issuedAt);
  const oraclePubKey = await getOraclePubKey();

  return NextResponse.json({ ...attestation, threshold, oraclePubKey });
}
