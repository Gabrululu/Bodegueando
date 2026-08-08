import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getOrCreateCode, resolveCode } from "@/lib/bodegaCodes";

/** Genera (o reusa) el código permanente de 6 dígitos de una bodega. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = body?.address;

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }

  const code = getOrCreateCode(address);
  return NextResponse.json({ code });
}

/** Resuelve un código de bodega a su dirección — usado por BuyerPanel y /pagar/[code]. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const address = resolveCode(code);
  if (!address) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ address });
}
