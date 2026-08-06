import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { linkBodegaFromRecentMessages } from "@/lib/telegram";

/**
 * Called after the bodega owner sends `/vincular <su address>` to the bot in Telegram.
 * Scans recent bot messages for that exact text and, if found, saves the chat_id.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodegaAddress = body?.bodegaAddress;

  if (typeof bodegaAddress !== "string" || !isAddress(bodegaAddress)) {
    return NextResponse.json({ error: "bodegaAddress must be a valid address" }, { status: 400 });
  }

  const linked = await linkBodegaFromRecentMessages(bodegaAddress);
  return NextResponse.json({ linked });
}
