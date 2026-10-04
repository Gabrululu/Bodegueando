import type { NextRequest } from "next/server";
import { incrementCounter } from "./kv";

/**
 * Server-only: límite de llamadas por ventana fija, sobre los contadores de lib/kv.ts.
 *
 * La clave incluye el número de ventana, así que el conteo se reinicia solo al cambiar de
 * ventana aunque el backend ignore el TTL (fallback de archivo); en Redis el TTL además borra
 * las claves viejas.
 */
export async function hitRateLimit(name: string, limit: number, windowSeconds: number): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const count = await incrementCounter(`ratelimit:${name}:${window}`, windowSeconds);
  return count > limit;
}

/** IP de quien llama. En Vercel, `x-forwarded-for` la pone la plataforma (primer valor). */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
