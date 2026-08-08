import { NextRequest, NextResponse } from "next/server";
import { consumeCode } from "@/lib/linkCodes";
import { linkChatToAddress } from "@/lib/telegram";

/**
 * Llamado por el daemon del bot (scripts/telegram-bot.mjs) cuando alguien manda
 * `/vincular <code>` por Telegram. No la llama el navegador directamente.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = body?.code;
  const chatId = body?.chatId;

  if (typeof code !== "string" || typeof chatId !== "number") {
    return NextResponse.json({ error: "code and chatId are required" }, { status: 400 });
  }

  const address = consumeCode(code);
  if (!address) {
    return NextResponse.json({ linked: false });
  }

  await linkChatToAddress(address, chatId);
  return NextResponse.json({ linked: true, address });
}
