import { NextRequest, NextResponse } from "next/server";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { setLocation, getLocation, getAllLocations } from "@/lib/bodegaLocations";
import { accountActionMessage } from "@/lib/accountActionMessage";
import { verifyBodegaOwner } from "@/lib/ownerAuth";

/**
 * Guarda (o actualiza) dónde aparece una bodega en el mapa. Exige la firma de la dueña sobre
 * esas coordenadas exactas (lib/accountActionMessage.ts + lib/ownerAuth.ts): si no, cualquiera
 * podría mover el pin de una bodega ajena.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { address, lat, lng, signature } = body ?? {};
  const issuedAt = Number(body?.issuedAt);

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng must be numbers" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "lat/lng out of range" }, { status: 400 });
  }
  if (typeof signature !== "string" || !isHex(signature)) {
    return NextResponse.json({ error: "signature is required" }, { status: 400 });
  }

  const message = accountActionMessage("bodega-location", address, issuedAt, { lat, lng });
  const auth = await verifyBodegaOwner({ bodega: address as Address, message, signature: signature as Hex, issuedAt });
  if (!auth.ok) {
    return NextResponse.json({ error: "No pudimos verificar que esta bodega sea tuya.", reason: auth.reason }, { status: auth.status });
  }

  await setLocation(address, lat, lng);
  return NextResponse.json({ ok: true });
}

/**
 * Sin `?address=`: devuelve la ubicación de todas las bodegas (alimenta el mapa del
 * comprador). Con `?address=`: devuelve solo la de esa bodega (para precargarla en su panel).
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (address) {
    if (!isAddress(address)) {
      return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
    }
    const location = await getLocation(address);
    return NextResponse.json({ location: location ?? null });
  }

  const locations = await getAllLocations();
  return NextResponse.json({ locations });
}
