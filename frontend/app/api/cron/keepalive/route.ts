import { NextRequest, NextResponse } from "next/server";
import { getValue, setValue } from "@/lib/kv";

/**
 * Keep-alive de Upstash — la llama el cron de Vercel una vez al día (ver vercel.json).
 *
 * Las bases gratis de Upstash se archivan tras ~30 días sin actividad: la data se guarda en
 * un backup, pero restaurarla crea una base NUEVA con otra URL/token, lo que obliga a cambiar
 * UPSTASH_REDIS_REST_URL/TOKEN en Vercel y redeployar. Un PING no cuenta como actividad, así
 * que acá se hace un SET y un GET reales sobre una clave propia (no toca datos de la app).
 *
 * Vercel manda `Authorization: Bearer $CRON_SECRET` en cada ejecución del cron; sin ese
 * header la ruta responde 401 para que nadie más pueda pegarle.
 */
const KEEPALIVE_KEY = "keepalive:last";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Sin credenciales, lib/kv.ts cae al archivo local — escribir ahí no mantiene viva ninguna
  // base, así que mejor fallar visible en los logs del cron.
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return NextResponse.json({ error: "upstash_not_configured" }, { status: 503 });
  }

  const now = new Date().toISOString();
  await setValue(KEEPALIVE_KEY, now);
  const stored = await getValue(KEEPALIVE_KEY);

  return NextResponse.json({ ok: stored === now, at: now });
}
