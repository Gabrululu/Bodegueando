import { buildEddsa, buildPoseidon } from "circomlibjs";

/**
 * EdDSA-BabyJubJub signing for the credit-certificate circuit — deliberately a different
 * key type from ORACLE_PRIVATE_KEY (a secp256k1 Ethereum key used elsewhere for
 * updateScoreFromAi). A circuit can't cheaply verify a secp256k1 signature; EdDSA over
 * BabyJubJub is the curve native to the circuit's field, and circomlibjs implements it with
 * the exact same parameters contracts/circom-credit-certificate/circuits/creditCertificate.circom
 * verifies — using anything else here would silently produce proofs that never verify.
 *
 * Building the eddsa/poseidon WASM instances is the expensive part, so both are cached
 * across requests in this module-level singleton (Next.js keeps a route's module warm
 * between invocations in the same server process).
 */
let eddsaPromise: ReturnType<typeof buildEddsa> | null = null;
let poseidonPromise: ReturnType<typeof buildPoseidon> | null = null;

async function getEddsa() {
  if (!eddsaPromise) eddsaPromise = buildEddsa();
  return eddsaPromise;
}

async function getPoseidon() {
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  return poseidonPromise;
}

function privateKeyBuffer(): Buffer {
  const hex = process.env.ZK_ORACLE_PRIVATE_KEY;
  if (!hex) throw new Error("ZK_ORACLE_PRIVATE_KEY is not configured");
  return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

export interface Attestation {
  score: string;
  issuedAt: string;
  R8x: string;
  R8y: string;
  S: string;
  oracleAx: string;
  oracleAy: string;
}

/** Public key of the configured ZK oracle, as the two field elements the circuit expects. */
export async function getOraclePubKey(): Promise<{ ax: string; ay: string }> {
  const eddsa = await getEddsa();
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  const pubKey = eddsa.prv2pub(privateKeyBuffer());
  return { ax: F.toObject(pubKey[0]).toString(), ay: F.toObject(pubKey[1]).toString() };
}

/**
 * Signs poseidon(bodega, score, issuedAt) — the exact message
 * circuits/creditCertificate.circom hashes and verifies inside the proof. `bodega` must
 * already be the numeric field-element form of the address (BigInt(address)).
 */
export async function signAttestation(bodega: bigint, score: bigint, issuedAt: bigint): Promise<Attestation> {
  const eddsa = await getEddsa();
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  const prvKey = privateKeyBuffer();
  const msg = poseidon([bodega, score, issuedAt]);
  const signature = eddsa.signPoseidon(prvKey, msg);
  const pubKey = eddsa.prv2pub(prvKey);

  return {
    score: score.toString(),
    issuedAt: issuedAt.toString(),
    R8x: F.toObject(signature.R8[0]).toString(),
    R8y: F.toObject(signature.R8[1]).toString(),
    S: signature.S.toString(),
    oracleAx: F.toObject(pubKey[0]).toString(),
    oracleAy: F.toObject(pubKey[1]).toString(),
  };
}
