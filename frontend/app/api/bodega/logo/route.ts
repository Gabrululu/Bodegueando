import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getLogo } from "@/lib/bodegaProfiles";

/**
 * GET ?address=0x…&v=<logoVersion> → el logo de la bodega como imagen. `v` cambia cada vez que
 * se sube un logo nuevo (lo trae el perfil), así que la respuesta se puede cachear sin miedo a
 * mostrar uno viejo.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }
  const logo = await getLogo(address);
  if (!logo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": request.nextUrl.searchParams.get("v")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
