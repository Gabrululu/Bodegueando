import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cliente de la cadena falso: cada test define qué código hay en la cuenta, quién es su owner(),
 * qué dirección le asigna la factory a cada firmante y si es bodega.
 */
const chain = {
  code: "0x" as string,
  owner: "0x0000000000000000000000000000000000000000" as string,
  factoryAddressFor: (() => "0x0000000000000000000000000000000000000000") as (signer: string) => string,
  isBodega: false,
};

vi.mock("viem", async (importOriginal) => {
  const viem = await importOriginal<typeof import("viem")>();
  return {
    ...viem,
    createPublicClient: () => ({
      getCode: async () => chain.code,
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        if (functionName === "owner") return chain.owner;
        if (functionName === "getAddress") return chain.factoryAddressFor(args![0] as string);
        if (functionName === "isBodega") return chain.isBodega;
        throw new Error(`unexpected call ${functionName}`);
      },
    }),
  };
});
vi.mock("@/lib/contracts", () => ({
  paymentRouterAbi: [],
  paymentRouterAddress: "0x3E774Bb89AD93aAEE1ddd3d6cEeE609B712b655b",
}));

const { verifyAccountOwner, verifyBodegaOwner } = await import("@/lib/ownerAuth");

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

async function signed(by = owner, issuedAt = Date.now()) {
  const message = `test ${issuedAt}`;
  return { message, issuedAt, signature: await by.signMessage({ message }) };
}

describe("lib/ownerAuth", () => {
  beforeEach(() => {
    chain.code = "0x";
    chain.owner = owner.address;
    chain.factoryAddressFor = (signer) => (signer === owner.address ? ACCOUNT : "0x2222222222222222222222222222222222222222");
    chain.isBodega = false;
  });

  it("cuenta desplegada: acepta a su owner() y rechaza a otro", async () => {
    chain.code = "0x6080";
    expect(await verifyAccountOwner({ account: ACCOUNT, ...(await signed()) })).toEqual({ ok: true });
    expect(await verifyAccountOwner({ account: ACCOUNT, ...(await signed(stranger)) })).toMatchObject({ ok: false, reason: "not_owner" });
  });

  it("cuenta sin desplegar: compara con la dirección que le asigna la factory", async () => {
    expect(await verifyAccountOwner({ account: ACCOUNT, ...(await signed()) })).toEqual({ ok: true });
    expect(await verifyAccountOwner({ account: ACCOUNT, ...(await signed(stranger)) })).toMatchObject({ ok: false, reason: "not_owner" });
  });

  it("rechaza firmas vencidas y firmas inválidas", async () => {
    const old = await signed(owner, Date.now() - 11 * 60 * 1000);
    expect(await verifyAccountOwner({ account: ACCOUNT, ...old })).toMatchObject({ ok: false, reason: "signature_expired" });
    expect(
      await verifyAccountOwner({ account: ACCOUNT, message: "x", signature: "0x1234", issuedAt: Date.now() }),
    ).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("verifyBodegaOwner además exige que sea bodega", async () => {
    chain.code = "0x6080";
    expect(await verifyBodegaOwner({ bodega: ACCOUNT, ...(await signed()) })).toMatchObject({ ok: false, reason: "not_a_bodega" });
    chain.isBodega = true;
    expect(await verifyBodegaOwner({ bodega: ACCOUNT, ...(await signed()) })).toEqual({ ok: true });
  });
});
