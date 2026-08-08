import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getChatIdForBodega, sendTelegramMessage } from "@/lib/telegram";

/**
 * Sends a Telegram message to whichever chat is linked to `bodegaAddress`. Silently
 * no-ops (sent: false) if that bodega never linked Telegram — this is a best-effort
 * notification, not something a payment should ever fail over.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodegaAddress = body?.bodegaAddress;
  const text = body?.text;

  if (typeof bodegaAddress !== "string" || !isAddress(bodegaAddress)) {
    return NextResponse.json({ error: "bodegaAddress must be a valid address" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const chatId = await getChatIdForBodega(bodegaAddress);
  if (!chatId) {
    return NextResponse.json({ sent: false, reason: "not_linked" });
  }

  const sent = await sendTelegramMessage(chatId, text);
  return NextResponse.json({ sent });
}
