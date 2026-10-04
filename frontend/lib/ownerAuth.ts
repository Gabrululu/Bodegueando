import { createPublicClient, http, parseAbi, recoverMessageAddress, type Address, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { paymentRouterAbi, paymentRouterAddress } from "./contracts";

/**
 * Server-only: comprueba que un mensaje lo firmó la dueña de una smart account de la app.
 *
 * Las cuentas de la app son SimpleAccount (eth-infinitism, EntryPoint v0.7), que no implementan
 * firmas ERC-1271 — no hay `isValidSignature` que consultar. Lo que sí tienen es una dueña: la
 * wallet embebida de Privy que firma sus transacciones. Así que el navegador firma con esa wallet
 * (personal_sign) y acá se recupera el firmante y se compara con:
 * - `owner()` leído on-chain, si la cuenta ya está desplegada;
 * - si todavía no lo está (una cuenta nueva no se despliega hasta su primera transacción), la
 *   dirección que la factory de SimpleAccount le asigna a ese firmante (`getAddress(owner, 0)`,
 *   el mismo índice que usa `toSimpleSmartAccount` en lib/smartAccount.ts).
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];
const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
const simpleAccountAbi = parseAbi(["function owner() view returns (address)"]);
const simpleAccountFactoryAbi = parseAbi(["function getAddress(address owner, uint256 salt) view returns (address)"]);
/** SimpleAccountFactory v0.7 — la que usa permissionless.js por defecto para EntryPoint v0.7. */
const SIMPLE_ACCOUNT_FACTORY: Address = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985";

/** Una firma vale 10 minutos — evita que alguien reutilice una vieja. */
const MAX_AGE_MS = 10 * 60 * 1000;

export type OwnerAuthResult = { ok: true } | { ok: false; reason: string; status: number };

type SignedRequest = {
  message: string;
  signature: Hex;
  issuedAt: number;
};

/** La firma es de la dueña de `account` (cualquier cuenta de la app, desplegada o no). */
export async function verifyAccountOwner(params: SignedRequest & { account: Address }): Promise<OwnerAuthResult> {
  const { account, message, signature, issuedAt } = params;

  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) {
    return { ok: false, reason: "signature_expired", status: 401 };
  }

  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature });
  } catch {
    return { ok: false, reason: "invalid_signature", status: 401 };
  }

  const code = await client.getCode({ address: account });
  let expected: Address;
  try {
    expected =
      code && code !== "0x"
        ? await client.readContract({ address: account, abi: simpleAccountAbi, functionName: "owner" })
        : await client.readContract({
            address: SIMPLE_ACCOUNT_FACTORY,
            abi: simpleAccountFactoryAbi,
            functionName: "getAddress",
            args: [signer, BigInt(0)],
          });
  } catch {
    // Hay código en esa dirección pero no es una SimpleAccount.
    return { ok: false, reason: "not_a_smart_account", status: 403 };
  }

  // Desplegada: `expected` es la dueña. Sin desplegar: es la cuenta que le tocaría al firmante.
  const matches =
    code && code !== "0x"
      ? expected.toLowerCase() === signer.toLowerCase()
      : expected.toLowerCase() === account.toLowerCase();
  if (!matches) return { ok: false, reason: "not_owner", status: 403 };

  return { ok: true };
}

/** Como verifyAccountOwner, y además la cuenta tiene que ser una bodega registrada. */
export async function verifyBodegaOwner(params: SignedRequest & { bodega: Address }): Promise<OwnerAuthResult> {
  const { bodega, ...signed } = params;
  const auth = await verifyAccountOwner({ account: bodega, ...signed });
  if (!auth.ok) return auth;

  if (!paymentRouterAddress) return { ok: false, reason: "not_configured", status: 503 };
  const isBodega = await client.readContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: [bodega],
  });
  if (!isBodega) return { ok: false, reason: "not_a_bodega", status: 403 };

  return { ok: true };
}
