import { Redis } from "@upstash/redis";
import fs from "fs";
import path from "path";

/**
 * Storage de un solo blob JSON por nombre, con dos backends:
 * - Upstash Redis (REST, funciona desde funciones serverless) cuando están seteadas
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — persiste de verdad y se comparte
 *   entre invocaciones, a diferencia del filesystem de Vercel (efímero por invocación:
 *   cada una puede correr en una instancia distinta que nunca vio lo que otra escribió).
 * - Un archivo JSON bajo .data/ como respaldo cuando esas env vars no están — así el
 *   desarrollo local sigue funcionando sin depender de una cuenta de Upstash. Este
 *   respaldo NUNCA debe asumirse persistente en producción — ver nota en el README.
 *
 * Los stores que usan esto (bodegaCodes.ts, telegram.ts) son chicos (un puñado de
 * mapeos código<->dirección o bodega<->chat_id), así que leer/escribir el blob entero
 * en cada operación es más simple que modelar comandos Redis por clave.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function filePathFor(name: string): string {
  return path.join(process.cwd(), ".data", `${name}.json`);
}

export async function readJsonStore<T>(name: string, fallback: T): Promise<T> {
  if (redis) {
    const value = await redis.get<T>(name);
    return value ?? fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePathFor(name), "utf-8"));
  } catch {
    return fallback;
  }
}

export async function writeJsonStore<T>(name: string, value: T): Promise<void> {
  if (redis) {
    await redis.set(name, value);
    return;
  }
  const filePath = filePathFor(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}
