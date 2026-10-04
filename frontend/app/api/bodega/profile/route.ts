import { NextRequest, NextResponse } from "next/server";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { getProfile, getProfiles, saveProfile } from "@/lib/bodegaProfiles";
import { verifyBodegaOwner } from "@/lib/ownerAuth";
import {
  cleanFields,
  LOGO_DATA_URL,
  MAX_LOGO_BYTES,
  profileMessage,
  profilePayloadHash,
  type LogoChange,
} from "@/lib/bodega/profileMessage";

const MAX_BATCH = 50;

/**
 * GET ?address=0x…            → perfil de una bodega (o null).
 * GET ?addresses=0x…,0x…      → perfiles de varias (para el mapa); solo las que tienen uno.
 */
export async function GET(request: NextRequest) {
  const single = request.nextUrl.searchParams.get("address");
  if (single) {
    if (!isAddress(single)) return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
    return NextResponse.json({ profile: await getProfile(single) });
  }

  const list = (request.nextUrl.searchParams.get("addresses") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (list.length === 0 || list.length > MAX_BATCH || !list.every((a) => isAddress(a))) {
    return NextResponse.json({ error: `addresses must be 1-${MAX_BATCH} valid addresses` }, { status: 400 });
  }
  return NextResponse.json({ profiles: await getProfiles(list) });
}

/**
 * Guarda el perfil. Exige la firma de la dueña de la cuenta sobre el hash exacto de lo que se
 * guarda (ver lib/bodega/profileMessage.ts y lib/ownerAuth.ts).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodega = body?.bodega;
  const signature = body?.signature;
  const issuedAt = Number(body?.issuedAt);

  if (typeof bodega !== "string" || !isAddress(bodega)) {
    return NextResponse.json({ error: "bodega must be a valid address" }, { status: 400 });
  }
  if (typeof signature !== "string" || !isHex(signature)) {
    return NextResponse.json({ error: "signature is required" }, { status: 400 });
  }

  const fields = cleanFields(body?.fields ?? {});
  if (fields.name.length < 2) {
    return NextResponse.json({ error: "El nombre debe tener al menos 2 letras.", reason: "invalid_name" }, { status: 400 });
  }

  let logo: LogoChange = { action: "keep" };
  let storedLogo: Parameters<typeof saveProfile>[2] = { action: "keep" };
  if (body?.logo?.action === "remove") {
    logo = storedLogo = { action: "remove" };
  } else if (body?.logo?.action === "set") {
    const dataUrl = String(body.logo.dataUrl ?? "");
    const match = LOGO_DATA_URL.exec(dataUrl);
    if (!match) {
      return NextResponse.json({ error: "El logo debe ser una imagen PNG, JPG o WebP.", reason: "invalid_logo" }, { status: 400 });
    }
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "El logo es demasiado pesado.", reason: "logo_too_large" }, { status: 413 });
    }
    logo = { action: "set", dataUrl };
    storedLogo = { action: "set", mime: `image/${match[1]}`, base64: match[2] };
  }

  const message = profileMessage(bodega, profilePayloadHash(bodega, fields, logo), issuedAt);
  const auth = await verifyBodegaOwner({ bodega: bodega as Address, message, signature: signature as Hex, issuedAt });
  if (!auth.ok) {
    return NextResponse.json({ error: "No pudimos verificar que esta bodega sea tuya.", reason: auth.reason }, { status: auth.status });
  }

  const profile = await saveProfile(bodega, fields, storedLogo);
  return NextResponse.json({ profile });
}
