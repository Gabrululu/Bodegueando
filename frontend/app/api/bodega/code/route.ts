import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getOrCreateCode, resolveCode, type CodePool } from "@/lib/bodegaCodes";

function parsePool(value: unknown): CodePool | null {
  return value === "bodega" || value === "buyer" ? value : null;
}

/** Genera (o reusa) el código permanente de 6 dígitos de una bodega o de un comprador. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = body?.address;
  const pool = parsePool(body?.pool);

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }
  if (!pool) {
    return NextResponse.json({ error: "pool must be 'bodega' or 'buyer'" }, { status: 400 });
  }

  const code = await getOrCreateCode(pool, address);
  return NextResponse.json({ code });
}

/**
 * Resuelve un código a su dirección — usado por BuyerPanel y /pagar/[code] (pool=bodega) y
 * por BodegaOwnerPanel (pool=buyer, para fiarle a un cliente o emitir un beneficio). Los dos
 * pools son namespaces separados: el mismo código de 6 dígitos puede existir en ambos a la
 * vez apuntando a direcciones distintas, así que resolver sin especificar el pool sería
 * ambiguo — por eso es un parámetro requerido, no una adivinanza del servidor.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const pool = parsePool(request.nextUrl.searchParams.get("pool"));

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  if (!pool) {
    return NextResponse.json({ error: "pool must be 'bodega' or 'buyer'" }, { status: 400 });
  }

  const address = await resolveCode(pool, code);
  if (!address) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ address });
}
