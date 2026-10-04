import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { signAttestation, verifyAttestation } from "@/lib/zkOracle";

const BODEGA = BigInt("0x27189d48fc8d48c22a45b4ecb573deeb4b198493");

describe("lib/zkOracle", () => {
  beforeAll(() => {
    process.env.ZK_ORACLE_PRIVATE_KEY = `0x${randomBytes(32).toString("hex")}`;
  });

  it("verifica una atestación propia y rechaza una alterada", async () => {
    const attestation = await signAttestation(BODEGA, BigInt(600), BigInt(1790000000));
    expect(await verifyAttestation(BODEGA, attestation)).toBe(true);
    expect(await verifyAttestation(BODEGA, { ...attestation, score: "900" })).toBe(false);
    expect(await verifyAttestation(BODEGA + BigInt(1), attestation)).toBe(false);
    expect(await verifyAttestation(BODEGA, { ...attestation, S: "not-a-number" })).toBe(false);
  }, 30_000);
});
