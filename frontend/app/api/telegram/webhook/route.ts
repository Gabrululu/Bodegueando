import { NextRequest, NextResponse } from "next/server";
import { dispatchTelegramCommand } from "@/lib/telegramCommands";

/**
 * Webhook de Telegram — reemplaza al daemon de polling (scripts/telegram-bot.mjs) en
 * producción. Vercel no puede correr un proceso que quede escuchando `getUpdates` para
 * siempre (cada función serverless responde una vez y se apaga); un webhook sí encaja con
 * ese modelo: Telegram llama a esta ruta cada vez que alguien le escribe al bot.
 *
 * Registrado una sola vez con `setWebhook` (ver README, sección "El bot de Telegram como
 * perfil"). El daemon de polling se mantiene aparte para desarrollo local, donde no hay una
 * URL pública HTTPS para que Telegram pueda llamar.
 *
 * Valida el header `X-Telegram-Bot-Api-Secret-Token` contra TELEGRAM_WEBHOOK_SECRET (se
 * define al registrar el webhook) para que nadie más pueda pegarle a esta ruta simulando
 * ser Telegram.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;

  if (typeof chatId === "number" && typeof text === "string") {
    try {
      await dispatchTelegramCommand(chatId, text);
    } catch (error) {
      console.error("telegram webhook dispatch failed", error);
    }
  }

  // Siempre 200: si devolviéramos error, Telegram reintentaría el mismo update sin parar.
  return NextResponse.json({ ok: true });
}
