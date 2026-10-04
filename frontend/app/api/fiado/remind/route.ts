import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { fiadoScoringAbi, fiadoScoringAddress } from "@/lib/contracts";
import { getOrCreateCode } from "@/lib/bodegaCodes";
import { getExchangeRates } from "@/lib/exchangeRate";
import { setIfNotExists } from "@/lib/kv";
import { getChatIdForBodega, sendTelegramMessage } from "@/lib/telegram";

/**
 * "Recordarle" desde la lista de "Quién te debe": le manda al cliente, por Telegram, un aviso de
 * su deuda de fiado con una bodega.
 *
 * A diferencia de /api/telegram/notify, acá quien llama no elige el texto: el mensaje se arma en
 * el servidor con la deuda leída on-chain (`FiadoScoring.getFiadoDebt`), y solo se manda si de
 * verdad hay deuda. Además, como mucho un recordatorio por día por par bodega/cliente, para que
 * nadie pueda usar la ruta para molestar a un cliente.
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const MIN_DEBT_USD = 0.005;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodega = body?.bodega;
  const customer = body?.customer;

  if (typeof bodega !== "string" || !isAddress(bodega) || typeof customer !== "string" || !isAddress(customer)) {
    return NextResponse.json({ error: "bodega and customer must be valid addresses" }, { status: 400 });
  }
  if (!fiadoScoringAddress) {
    return NextResponse.json({ sent: false, reason: "not_configured" });
  }

  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const debt = (await client.readContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getFiadoDebt",
    args: [bodega as Address, customer as Address],
  })) as bigint;
  const debtUsd = Number(debt) / 1e18;
  if (debtUsd <= MIN_DEBT_USD) {
    return NextResponse.json({ sent: false, reason: "no_debt" });
  }

  const chatId = await getChatIdForBodega(customer);
  if (!chatId) {
    return NextResponse.json({ sent: false, reason: "not_linked" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const firstToday = await setIfNotExists(`fiado-remind:${bodega.toLowerCase()}:${customer.toLowerCase()}:${today}`, "1");
  if (!firstToday) {
    return NextResponse.json({ sent: false, reason: "already_reminded_today" });
  }

  const [{ usdPen }, bodegaCode] = await Promise.all([getExchangeRates(), getOrCreateCode("bodega", bodega)]);
  const text =
    `🔔 Recordatorio de Bodegueando\n` +
    `Tienes S/ ${(debtUsd * usdPen).toFixed(2)} pendiente de fiado en la bodega #${bodegaCode}.\n` +
    `Puedes pagarlo desde la app, escribiendo el código de la bodega.`;

  const sent = await sendTelegramMessage(chatId, text);
  return NextResponse.json({ sent });
}
