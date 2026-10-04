import { NextRequest, NextResponse } from "next/server";
import { checkPaymasterHealth, paymasterAlertText } from "@/lib/paymasterHealth";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Chequeo diario de PuntosPaymaster — lo llama el cron de Vercel (ver vercel.json). Revisa el
 * depósito de gas y si `puntosPerEth` se desvió del precio de mercado (lib/paymasterHealth.ts) y,
 * si algo necesita atención, le avisa por Telegram a quien opera la app (TELEGRAM_ADMIN_CHAT_ID).
 * Solo avisa: recargar el depósito o actualizar la tasa sigue siendo una decisión a mano.
 *
 * Igual que /api/cron/keepalive, solo responde a `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let health;
  try {
    health = await checkPaymasterHealth();
  } catch (err) {
    console.error("[paymaster-health] check failed", err);
    return NextResponse.json({ error: "check_failed" }, { status: 502 });
  }
  if (!health) return NextResponse.json({ error: "paymaster_not_configured" }, { status: 503 });

  const alert = paymasterAlertText(health);
  const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
  const alerted = alert && adminChatId ? await sendTelegramMessage(adminChatId, alert) : false;
  if (alert) console.warn("[paymaster-health]", alert);

  return NextResponse.json({ ok: !alert, alerted, ...health });
}
