import { NextRequest, NextResponse } from "next/server";
import { getProfileText } from "@/lib/telegramProfile";

/**
 * Texto de perfil que el daemon del bot de desarrollo (scripts/telegram-bot.mjs) reenvía
 * tal cual cuando alguien manda /perfil. En producción, el webhook
 * (app/api/telegram/webhook/route.ts) llama a getProfileText directo, sin pasar por acá —
 * esta ruta sigue existiendo para el daemon de desarrollo y para debug manual.
 */
export async function GET(request: NextRequest) {
  const chatIdParam = request.nextUrl.searchParams.get("chatId");
  const chatId = chatIdParam ? Number(chatIdParam) : NaN;

  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "chatId must be a number" }, { status: 400 });
  }

  const text = await getProfileText(chatId);
  return NextResponse.json({ text });
}
