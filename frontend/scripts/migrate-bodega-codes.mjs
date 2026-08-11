// Migración de un solo uso: mueve los códigos ya asignados bajo el esquema viejo (un blob
// JSON en la clave Redis "bodega-codes", leído/escrito con lib/kv.ts readJsonStore/
// writeJsonStore) al esquema nuevo de claves atómicas por-pool que usa lib/bodegaCodes.ts
// desde que se separaron los pools "bodega"/"buyer" y se dejó de compartir un blob entero
// entre todos los códigos (ver README/ARCHITECTURE.md, sección de códigos de 6 dígitos).
//
// El blob viejo no distinguía bodega de comprador, así que para clasificar cada dirección en
// el pool correcto se consulta PaymentRouter.isBodega on-chain — la misma fuente de verdad
// que ya usa el resto de la app. No borra el blob viejo (queda como respaldo inerte; nada lo
// vuelve a leer después de esta migración).
//
// Correr una sola vez, a mano: pnpm run migrate-bodega-codes

import { Redis } from "@upstash/redis";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

const RPC_URL = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const PAYMENT_ROUTER_ADDRESS = process.env.NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — no hay nada que migrar en local.");
  process.exit(1);
}
if (!RPC_URL || !PAYMENT_ROUTER_ADDRESS) {
  console.error("Faltan NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL / NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS.");
  process.exit(1);
}

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC_URL) });

const IS_BODEGA_ABI = [
  { type: "function", name: "isBodega", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
];

function isValidAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

async function main() {
  const old = await redis.get("bodega-codes");
  if (!old || !old.addressToCode) {
    console.log("No hay nada que migrar (bodega-codes viejo está vacío o no existe).");
    return;
  }

  const entries = Object.entries(old.addressToCode);
  console.log(`Encontrados ${entries.length} códigos bajo el esquema viejo.`);

  for (const [address, code] of entries) {
    if (!isValidAddress(address)) {
      console.warn(`  ⚠ ${address} → ${code}: dirección inválida, se salta (no se migra).`);
      continue;
    }

    const isBodega = await publicClient.readContract({
      address: PAYMENT_ROUTER_ADDRESS,
      abi: IS_BODEGA_ABI,
      functionName: "isBodega",
      args: [address],
    });
    const pool = isBodega ? "bodega" : "buyer";

    const codeKey = `code:${pool}:code:${code}`;
    const addrKey = `code:${pool}:addr:${address.toLowerCase()}`;

    const alreadyMigrated = await redis.get(addrKey);
    if (alreadyMigrated) {
      console.log(`  = ${address} ya tiene código en el pool "${pool}" (${alreadyMigrated}), se deja como está.`);
      continue;
    }

    await redis.set(codeKey, address.toLowerCase());
    await redis.set(addrKey, code);
    await redis.incr(`code:${pool}:count`); // mismo contador que usa el largo adaptativo (lib/bodegaCodes.ts)
    console.log(`  ✓ ${address} → ${code} migrado al pool "${pool}"`);
  }

  console.log("Listo. El blob viejo (\"bodega-codes\") se deja intacto como respaldo, ya no se usa.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
