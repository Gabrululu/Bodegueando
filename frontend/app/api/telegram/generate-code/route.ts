import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { createCode } from "@/lib/linkCodes";

/**
 * Genera un código corto de 6 dígitos para vincular la wallet logueada con Telegram,
 * sin que el chat de Telegram tenga que ver una dirección 0x... — el usuario manda
 * `/vincular <code>` al bot y el daemon (scripts/telegram-bot.mjs) llama a
 * consume-code con el chat_id real.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = body?.address;

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }

  const code = createCode(address);
  return NextResponse.json({ code });
}
