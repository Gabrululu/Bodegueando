import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { setLocation, getLocation, getAllLocations } from "@/lib/bodegaLocations";

/** Guarda (o actualiza) dónde aparece una bodega en el mapa. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { address, lat, lng } = body ?? {};

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng must be numbers" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "lat/lng out of range" }, { status: 400 });
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
