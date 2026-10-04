import { createPublicClient, http, parseAbi, recoverMessageAddress, type Address, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { paymentRouterAbi, paymentRouterAddress } from "./contracts";

/**
 * Server-only: comprueba que un mensaje lo firmó la dueña de la smart account de una bodega.
 *
 * Las cuentas de la app son SimpleAccount (eth-infinitism, EntryPoint v0.7), que no implementan
 * firmas ERC-1271 — no hay `isValidSignature` que consultar. Lo que sí exponen es `owner()`: la
 * wallet embebida de Privy que firma sus transacciones. Así que el navegador firma con esa wallet
 * (personal_sign) y acá se recupera el firmante y se compara con `owner()` leído on-chain.
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];
const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
const simpleAccountAbi = parseAbi(["function owner() view returns (address)"]);

/** Una firma vale 10 minutos — evita que alguien reutilice una vieja. */
const MAX_AGE_MS = 10 * 60 * 1000;

export type OwnerAuthResult = { ok: true } | { ok: false; reason: string; status: number };

export async function verifyBodegaOwner(params: {
  bodega: Address;
  message: string;
  signature: Hex;
  issuedAt: number;
}): Promise<OwnerAuthResult> {
  const { bodega, message, signature, issuedAt } = params;

  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) {
    return { ok: false, reason: "signature_expired", status: 401 };
  }

  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature });
  } catch {
    return { ok: false, reason: "invalid_signature", status: 401 };
  }

  let owner: Address;
  try {
    owner = await client.readContract({ address: bodega, abi: simpleAccountAbi, functionName: "owner" });
  } catch {
    // Sin código en esa dirección (cuenta todavía no desplegada) o no es una SimpleAccount.
    return { ok: false, reason: "not_a_smart_account", status: 403 };
  }
  if (owner.toLowerCase() !== signer.toLowerCase()) {
    return { ok: false, reason: "not_owner", status: 403 };
  }

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
