import { randomInt } from "crypto";
import { deleteKey, getValue, incrementCounter, setIfNotExists } from "./kv";

/**
 * Códigos permanentes, deliberadamente separado de lib/linkCodes.ts (que es corto de vida y
 * de un solo uso, para vincular Telegram). El código de una bodega va en un cartel físico y se
 * escanea durante meses, así que nunca debe expirar ni cambiar de dueño.
 *
 * Dos pools independientes, no uno compartido:
 * - "bodega": el código permanente de una bodega (impreso en su cartel). Acotado — hay un
 *   número finito de bodegas reales en el Perú (~500-600 mil, ver README).
 * - "buyer": el código personal de un comprador (para que una bodega le fíe, o reciba un
 *   beneficio social). Sin cota real — cualquiera que use la app una vez recibe uno.
 * Compartir un solo espacio de 900,000 códigos (6 dígitos) entre ambas poblaciones garantiza
 * agotarlo apenas la base de compradores crece — separar los pools le da a las bodegas (la
 * población acotada) su propio margen, y aísla el riesgo real de agotamiento en el lado de
 * compradores.
 *
 * Largo adaptativo por pool: arranca en 6 dígitos (900,000 códigos). Cuando la cantidad ya
 * emitida en un pool llega al 80% de la capacidad del largo actual, los códigos NUEVOS de ese
 * pool pasan a emitirse un dígito más largo — mismo patrón que un número telefónico agregando
 * un dígito cuando un código de área se llena. Los códigos ya emitidos siguen resolviendo para
 * siempre, nunca se renumeran ni se acortan: resolver un código es un lookup por clave, no le
 * importa cuántos dígitos tenga. El contador (`code:<pool>:count`) se incrementa una sola vez
 * por dirección nueva realmente registrada — no en cada intento — así que decide el largo
 * futuro sin tener que escanear el pool completo.
 *
 * Reserva atómica: primero se intenta reservar un código al azar con setIfNotExists (SETNX en
 * Redis), y solo si eso se gana se intenta reclamar la dirección con otro setIfNotExists. Dos
 * requests concurrentes para la MISMA dirección pueden ambos reservar códigos distintos antes
 * de disputarse la dirección — quien pierde libera su código de sobra (deleteKey) y devuelve
 * el que ganó, en vez de dejarlo huérfano para siempre.
 *
 * randomInt (crypto) en vez de Math.random: el código no es un secreto de seguridad — es un
 * puntero de UX a una dirección, la autorización real la hace la firma de la smart account —
 * pero usar el generador criptográfico no cuesta nada y cierra cualquier duda futura sobre
 * predictibilidad.
 */

export type CodePool = "bodega" | "buyer";

const MIN_CODE_LENGTH = 6;
const FILL_THRESHOLD = 0.8;
const MAX_ATTEMPTS = 10;

function capacityForLength(length: number): number {
  // Ej. largo 6: dígitos 100000-999999 → 900,000 códigos (se evita el 0 inicial).
  return 9 * 10 ** (length - 1);
}

function generateCode(length: number): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(randomInt(min, max + 1)); // randomInt: max exclusivo
}

function addressKey(pool: CodePool, address: string): string {
  return `code:${pool}:addr:${address.toLowerCase()}`;
}

function codeKey(pool: CodePool, code: string): string {
  return `code:${pool}:code:${code}`;
}

function countKey(pool: CodePool): string {
  return `code:${pool}:count`;
}

async function currentIssuanceLength(pool: CodePool): Promise<number> {
  const count = Number(await getValue(countKey(pool))) || 0;
  let length = MIN_CODE_LENGTH;
  while (count >= capacityForLength(length) * FILL_THRESHOLD) length++;
  return length;
}

export async function getOrCreateCode(pool: CodePool, address: string): Promise<string> {
  const addrKey = addressKey(pool, address);
  const existing = await getValue(addrKey);
  if (existing) return existing;

  const length = await currentIssuanceLength(pool);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode(length);
    const cKey = codeKey(pool, code);
    const reservedCode = await setIfNotExists(cKey, address.toLowerCase());
    if (!reservedCode) continue; // otra dirección ya tiene ese código — reintentar

    const claimedAddress = await setIfNotExists(addrKey, code);
    if (claimedAddress) {
      await incrementCounter(countKey(pool));
      return code;
    }

    // Otra request concurrente para esta MISMA dirección ganó la carrera primero. El código
    // que acabamos de reservar queda de sobra — liberarlo para que alguien más lo use, y
    // devolver el que ya está registrado (esto no cuenta como una emisión nueva).
    await deleteKey(cKey);
    const winner = await getValue(addrKey);
    if (winner) return winner;
  }

  throw new Error(`No se pudo reservar un código de ${pool} disponible tras ${MAX_ATTEMPTS} intentos.`);
}

export async function resolveCode(pool: CodePool, code: string): Promise<string | undefined> {
  const address = await getValue(codeKey(pool, code));
  return address ?? undefined;
}
