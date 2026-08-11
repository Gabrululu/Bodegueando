// Fase 4 del plan de códigos de 6 dígitos: alerta de ocupación de los pools "bodega"/"buyer"
// (ver lib/bodegaCodes.ts). Corre aparte del servidor de Next.js, mismo patrón que
// scripts/check-paymaster-balance.mjs (`pnpm run check-code-capacity`, a mano o desde un
// cron/CI) y manda el aviso al MISMO TELEGRAM_ADMIN_CHAT_ID que ese script — nunca a un
// bodeguero ni a un cliente. Ese chat_id es el tuyo como quien opera el proyecto, distinto del
// bot que le habla a bodegas/compradores (lib/telegramCommands.ts).
//
// A diferencia del paymaster, esto NO requiere ninguna acción manual: al cruzar el 80% de
// ocupación, lib/bodegaCodes.ts ya empieza a emitir códigos nuevos con un dígito más,
// automáticamente (Fase 2). Este aviso es solo informativo — para enterarte de que un pool
// está creciendo en vez de descubrirlo por accidente.

import { Redis } from "@upstash/redis";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const WARNING_THRESHOLD = Number(process.env.CODE_CAPACITY_WARNING_THRESHOLD || "0.7");

// Debe coincidir con MIN_CODE_LENGTH/FILL_THRESHOLD/capacityForLength de lib/bodegaCodes.ts —
// duplicado a propósito (igual que migrate-bodega-codes.mjs duplica su propio ABI mínimo en
// vez de importar lib/*.ts): un script suelto en scripts/ no pasa por los path aliases de
// Next.js, así que no puede importar "@/lib/bodegaCodes" sin un paso de build aparte.
const MIN_CODE_LENGTH = 6;
const AUTO_GROW_THRESHOLD = 0.8;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — sin Redis no hay nada que chequear.");
  process.exit(1);
}

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

function capacityForLength(length) {
  return 9 * 10 ** (length - 1);
}

function currentLength(count) {
  let length = MIN_CODE_LENGTH;
  while (count >= capacityForLength(length) * AUTO_GROW_THRESHOLD) length++;
  return length;
}

async function sendTelegramAlert(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_ADMIN_CHAT_ID no configurados — no se manda alerta, solo se loggea.");
    return;
  }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text }),
  }).catch(() => {});
}

async function checkPool(pool) {
  const count = Number(await redis.get(`code:${pool}:count`)) || 0;
  const length = currentLength(count);
  const capacity = capacityForLength(length);
  const occupancy = count / capacity;
  return { pool, count, length, capacity, occupancy };
}

async function main() {
  const pools = await Promise.all([checkPool("bodega"), checkPool("buyer")]);

  const warnLines = [];
  for (const p of pools) {
    const pct = (p.occupancy * 100).toFixed(1);
    console.log(`Pool "${p.pool}": ${p.count}/${p.capacity} códigos de ${p.length} dígitos ocupados (${pct}%).`);
    if (p.occupancy >= WARNING_THRESHOLD) {
      warnLines.push(`• "${p.pool}": ${pct}% ocupado (${p.count}/${p.capacity}, códigos de ${p.length} dígitos)`);
    }
  }

  if (warnLines.length > 0) {
    const text =
      `📈 Un pool de códigos se está acercando a su capacidad.\n\n${warnLines.join("\n")}\n\n` +
      `No hace falta ninguna acción manual — al llegar al 80% los códigos nuevos de ese pool ya se emiten con un dígito más, automáticamente. Este aviso es solo para que lo sepas.`;
    console.log(text);
    await sendTelegramAlert(text);
  } else {
    console.log("Todos los pools con margen de sobra todavía.");
  }
}

main().catch((err) => {
  console.error("No se pudo chequear la capacidad de los pools de códigos:", err);
  process.exit(1);
});
