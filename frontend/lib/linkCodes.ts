import { randomInt } from "crypto";
import { setIfNotExists, takeValue } from "./kv";

// Server-only: códigos cortos de un solo uso para vincular una wallet con un chat de Telegram
// sin que el chat muestre nunca una dirección 0x...
//
// Viven en lib/kv.ts (Redis en producción), no en memoria: en Vercel, la función que genera el
// código (/api/telegram/generate-code) y la que lo consume (el webhook) pueden correr en
// instancias distintas, y un Map en memoria de una no lo ve la otra.
const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 10;

function keyFor(code: string): string {
  return `tg-link:${code}`;
}

/**
 * El valor guarda el vencimiento junto a la dirección: Redis ya la borra sola al vencer (TTL),
 * pero el fallback de archivo ignora el TTL, así que consumeCode vuelve a comprobarlo.
 */
function encode(address: string, expiresAt: number): string {
  return `${expiresAt}:${address.toLowerCase()}`;
}

export async function createCode(address: string): Promise<string> {
  const expiresAt = Date.now() + CODE_TTL_SECONDS * 1000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = String(randomInt(100000, 1000000));
    if (await setIfNotExists(keyFor(code), encode(address, expiresAt), CODE_TTL_SECONDS)) return code;
  }
  throw new Error("No se pudo reservar un código de vinculación libre");
}

/** Devuelve la dirección del código y lo invalida (un solo uso), o undefined si no vale. */
export async function consumeCode(code: string): Promise<string | undefined> {
  if (!/^\d{6}$/.test(code)) return undefined;
  const raw = await takeValue(keyFor(code));
  if (typeof raw !== "string") return undefined;
  const separator = raw.indexOf(":");
  const expiresAt = Number(raw.slice(0, separator));
  if (separator < 0 || !(expiresAt > Date.now())) return undefined;
  return raw.slice(separator + 1);
}
