import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getChatIdForBodega } from "@/lib/telegram";

export async function GET(request: NextRequest) {
  const bodegaAddress = request.nextUrl.searchParams.get("bodegaAddress");

  if (!bodegaAddress || !isAddress(bodegaAddress)) {
    return NextResponse.json({ error: "bodegaAddress must be a valid address" }, { status: 400 });
  }

  const linked = (await getChatIdForBodega(bodegaAddress)) !== undefined;
  return NextResponse.json({ linked });
}
