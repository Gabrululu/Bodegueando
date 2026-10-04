import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, decodeEventLog, http, isAddress, isHash, parseAbiItem, type Address, type Hash } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { paymentRouterAddress, STABLECOIN_DECIMALS } from "@/lib/contracts";
import { getExchangeRates } from "@/lib/exchangeRate";
import { deleteKey, setIfNotExists } from "@/lib/kv";
import { getChatIdForBodega, sendTelegramMessage } from "@/lib/telegram";

/**
 * Avisos por Telegram a la cuenta vinculada a `bodegaAddress`. Quien llama NUNCA elige el texto:
 * antes esta ruta mandaba cualquier `text` a cualquier chat vinculado, lo que permitía usar el
 * bot oficial para mandar phishing a nombre de Bodegueando. Ahora solo hay dos avisos, armados acá:
 *
 * - `kind: "payment"` + `txHash`: se lee el recibo on-chain y solo se avisa si esa transacción
 *   contiene un `PaymentReceived` del PaymentRouter actual hacia esa bodega; el monto sale del
 *   evento, no del cliente. Un aviso por transacción, así que repetir la llamada no hace nada.
 * - `kind: "test"`: el mensaje fijo de "notificaciones activadas", como mucho uno cada 10 minutos
 *   por cuenta.
 *
 * Es best-effort: si la cuenta no vinculó Telegram responde `sent: false` sin error, porque un
 * pago nunca debería fallar por esto.
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const TEST_WINDOW_SECONDS = 10 * 60;
const paymentReceivedEvent = parseAbiItem(
  "event PaymentReceived(address indexed payer, address indexed bodega, uint256 amount, uint256 cashback)",
);

async function paymentTextFromChain(bodega: Address, txHash: Hash): Promise<string | null> {
  if (!paymentRouterAddress) return null;
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt || receipt.status !== "success") return null;

  let amount = BigInt(0);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== paymentRouterAddress.toLowerCase()) continue;
    try {
      const { eventName, args } = decodeEventLog({ abi: [paymentReceivedEvent], data: log.data, topics: log.topics });
      if (eventName === "PaymentReceived" && args.bodega.toLowerCase() === bodega.toLowerCase()) amount += args.amount;
    } catch {
      // Otro evento del router (FiadoRepaid, etc.) — no es un cobro.
    }
  }
  if (amount === BigInt(0)) return null;

  const { usdPen } = await getExchangeRates();
  const soles = (Number(amount) / 10 ** STABLECOIN_DECIMALS) * usdPen;
  return `💰 Te pagaron S/ ${soles.toFixed(2)} en Bodegueando.`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodegaAddress = body?.bodegaAddress;
  const kind = body?.kind;

  if (typeof bodegaAddress !== "string" || !isAddress(bodegaAddress)) {
    return NextResponse.json({ error: "bodegaAddress must be a valid address" }, { status: 400 });
  }
  if (kind !== "payment" && kind !== "test") {
    return NextResponse.json({ error: 'kind must be "payment" or "test"' }, { status: 400 });
  }
  const txHash = body?.txHash;
  if (kind === "payment" && (typeof txHash !== "string" || !isHash(txHash))) {
    return NextResponse.json({ error: "txHash must be a transaction hash" }, { status: 400 });
  }

  const chatId = await getChatIdForBodega(bodegaAddress);
  if (!chatId) {
    return NextResponse.json({ sent: false, reason: "not_linked" });
  }

  let text: string;
  let onceKey: string;
  if (kind === "payment") {
    const paymentText = await paymentTextFromChain(bodegaAddress as Address, txHash as Hash);
    if (!paymentText) {
      return NextResponse.json({ sent: false, reason: "payment_not_found" }, { status: 422 });
    }
    text = paymentText;
    onceKey = `tg-notify:payment:${(txHash as string).toLowerCase()}:${bodegaAddress.toLowerCase()}`;
  } else {
    text = "🔔 Notificaciones de Bodegueando activadas. Acá vas a ver tus pagos.";
    onceKey = `tg-notify:test:${bodegaAddress.toLowerCase()}:${Math.floor(Date.now() / 1000 / TEST_WINDOW_SECONDS)}`;
  }

  if (!(await setIfNotExists(onceKey, "1"))) {
    return NextResponse.json({ sent: false, reason: "already_sent" });
  }

  const sent = await sendTelegramMessage(chatId, text);
  // Si Telegram falló, se libera la marca para que se pueda reintentar.
  if (!sent) await deleteKey(onceKey);
  return NextResponse.json({ sent });
}
