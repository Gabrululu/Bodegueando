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
 * Los stores que usan esto (telegram.ts, bodegaLocations.ts) son chicos (un puñado de
 * mapeos bodega<->chat_id o de ubicaciones), así que leer/escribir el blob entero en cada
 * operación es más simple que modelar comandos Redis por clave. bodegaCodes.ts es la
 * excepción: ese store puede crecer a cientos de miles de entradas (una por cada bodega Y
 * cada comprador que use la app), donde este patrón deja de servir por dos motivos — leer y
 * reescribir un blob que solo crece es cada vez más lento/caro, y dos registros concurrentes
 * pueden pisarse (ambos leen el blob antes de que el otro escriba, y el segundo `write` borra
 * silenciosamente lo que acababa de guardar el primero). Por eso bodegaCodes.ts usa las
 * primitivas atómicas por-clave de abajo en vez de readJsonStore/writeJsonStore.
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

/**
 * Primitivas atómicas por-clave (get/setIfNotExists/delete), para stores que crecen sin
 * límite predecible. En Redis usan SETNX/GET/DEL de verdad — atómico en el servidor, y cada
 * operación toca solo su clave, no un blob completo. En el fallback de archivo (solo
 * desarrollo local — nunca asumir persistente en producción, igual que arriba) se simulan con
 * un mutex en proceso: Node es single-threaded, así que serializar el tramo
 * leer-verificar-escribir alcanza para que dos requests "concurrentes" en el mismo proceso de
 * `next dev` no se pisen. Todas las claves de un mismo store comparten un único archivo JSON
 * (`_kv.json`) — no hay archivo por clave.
 */
const fileMutex = { queue: Promise.resolve() };

async function withFileMutex<T>(fn: () => T): Promise<T> {
  const run = fileMutex.queue.then(fn, fn);
  fileMutex.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readKvFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(filePathFor("_kv"), "utf-8"));
  } catch {
    return {};
  }
}

function writeKvFile(data: Record<string, string>): void {
  const filePath = filePathFor("_kv");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** Reserva `key` con `value` solo si nadie la tenía todavía. Devuelve si la reserva fue tuya. */
export async function setIfNotExists(key: string, value: string): Promise<boolean> {
  if (redis) {
    const result = await redis.set(key, value, { nx: true });
    return result === "OK";
  }
  return withFileMutex(() => {
    const data = readKvFile();
    if (key in data) return false;
    data[key] = value;
    writeKvFile(data);
    return true;
  });
}

export async function getValue(key: string): Promise<string | null> {
  if (redis) return redis.get<string>(key);
  return withFileMutex(() => {
    const data = readKvFile();
    return data[key] ?? null;
  });
}

export async function deleteKey(key: string): Promise<void> {
  if (redis) {
    await redis.del(key);
    return;
  }
  await withFileMutex(() => {
    const data = readKvFile();
    delete data[key];
    writeKvFile(data);
  });
}

/** Incrementa `key` en 1 (atómico) y devuelve el nuevo valor. Arranca en 0 si no existía. */
export async function incrementCounter(key: string): Promise<number> {
  if (redis) return redis.incr(key);
  return withFileMutex(() => {
    const data = readKvFile();
    const next = (Number(data[key]) || 0) + 1;
    data[key] = String(next);
    writeKvFile(data);
    return next;
  });
}
