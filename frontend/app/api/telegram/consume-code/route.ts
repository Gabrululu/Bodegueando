import { NextRequest, NextResponse } from "next/server";
import { consumeCode } from "@/lib/linkCodes";
import { linkChatToAddress } from "@/lib/telegram";

/**
 * Llamado por el daemon del bot (scripts/telegram-bot.mjs) cuando alguien manda
 * `/vincular <code>` por Telegram. No la llama el navegador directamente.
 *
 * Con TELEGRAM_WEBHOOK_SECRET configurado exige el mismo header que el webhook: si no,
 * cualquiera podría probar códigos con un chat_id propio y quedarse con las alertas de pago de
 * otra cuenta. En producción el webhook vincula directo (lib/telegramCommands.ts) y esta ruta
 * no se usa.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const code = body?.code;
  const chatId = body?.chatId;

  if (typeof code !== "string" || typeof chatId !== "number") {
    return NextResponse.json({ error: "code and chatId are required" }, { status: 400 });
  }

  const address = await consumeCode(code);
  if (!address) {
    return NextResponse.json({ linked: false });
  }

  await linkChatToAddress(address, chatId);
  return NextResponse.json({ linked: true, address });
}
