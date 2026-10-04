import { NextRequest, NextResponse } from "next/server";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { accountActionMessage } from "@/lib/accountActionMessage";
import { createCode } from "@/lib/linkCodes";
import { verifyAccountOwner } from "@/lib/ownerAuth";

/**
 * Genera un código corto de 6 dígitos para vincular la wallet logueada con Telegram,
 * sin que el chat de Telegram tenga que ver una dirección 0x... — el usuario manda
 * `/vincular <code>` al bot y el daemon (scripts/telegram-bot.mjs) llama a
 * consume-code con el chat_id real.
 *
 * Exige la firma de la dueña de la cuenta (bodega o comprador, desplegada o no — ver
 * lib/ownerAuth.ts): quien vincula un chat recibe los avisos de pago de esa cuenta, así que nadie
 * debería poder pedir un código para una cuenta ajena.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = body?.address;

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }
  const signature = body?.signature;
  const issuedAt = Number(body?.issuedAt);
  if (typeof signature !== "string" || !isHex(signature)) {
    return NextResponse.json({ error: "signature is required" }, { status: 400 });
  }

  const auth = await verifyAccountOwner({
    account: address as Address,
    message: accountActionMessage("telegram-link", address, issuedAt),
    signature: signature as Hex,
    issuedAt,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: "No pudimos verificar que esta cuenta sea tuya.", reason: auth.reason }, { status: auth.status });
  }

  const code = await createCode(address);
  return NextResponse.json({ code });
}
