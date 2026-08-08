import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { getAddressForChat } from "./telegram";
import {
  fiadoScoringAbi,
  fiadoScoringAddress,
  paymentRouterAbi,
  paymentRouterAddress,
  puntosTokenAbi,
  puntosTokenAddress,
} from "./contracts";
import { getEthPenRate } from "./exchangeRate";
import { confianzaLabel } from "./fiado";

const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;

function client() {
  return createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
}

function formatSoles(weiAmount: bigint, ethPen: number): string {
  const eth = Number(weiAmount) / 1e18;
  return `S/ ${(eth * ethPen).toFixed(2)}`;
}

/**
 * Texto de perfil que tanto GET /api/telegram/profile (compatibilidad con el daemon de
 * desarrollo, scripts/telegram-bot.mjs) como el webhook de producción
 * (app/api/telegram/webhook/route.ts) mandan tal cual cuando alguien escribe /perfil.
 * Vive acá, no en la ruta, para no duplicarla entre los dos consumidores.
 */
export async function getProfileText(chatId: number): Promise<string> {
  const address = await getAddressForChat(chatId);
  if (!address) {
    return "Todavía no vinculaste tu cuenta. Entra a la web, genera un código y mándame /vincular <código>.";
  }

  if (!paymentRouterAddress || !fiadoScoringAddress || !puntosTokenAddress) {
    return "La app todavía no está conectada a los contratos.";
  }

  const c = client();
  const { ethPen } = await getEthPenRate();

  const isBodega = await c.readContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: [address as `0x${string}`],
  });

  if (isBodega) {
    const [score, creditLimit, fiadoEnabled, [amounts]] = await Promise.all([
      c.readContract({
        address: fiadoScoringAddress,
        abi: fiadoScoringAbi,
        functionName: "getScore",
        args: [address as `0x${string}`],
      }) as Promise<bigint>,
      c.readContract({
        address: fiadoScoringAddress,
        abi: fiadoScoringAbi,
        functionName: "getCreditLimit",
        args: [address as `0x${string}`],
      }) as Promise<bigint>,
      c.readContract({
        address: fiadoScoringAddress,
        abi: fiadoScoringAbi,
        functionName: "isFiadoEnabled",
        args: [address as `0x${string}`],
      }) as Promise<boolean>,
      c.readContract({
        address: fiadoScoringAddress,
        abi: fiadoScoringAbi,
        functionName: "getPaymentHistory",
        args: [address as `0x${string}`],
      }) as Promise<[bigint[], bigint[]]>,
    ]);

    const confianza = confianzaLabel(Number(score));
    const lines = [
      "📊 Tu bodega en Bodegueando",
      `Pagos recibidos: ${amounts.length}`,
      `Confianza: ${confianza.text} (${score}/1000)`,
      fiadoEnabled
        ? `Fiado: activado, ofreces hasta ${formatSoles(creditLimit, ethPen)} a tus clientes.`
        : "Fiado: apagado por ahora.",
    ];
    return lines.join("\n");
  }

  const points = (await c.readContract({
    address: puntosTokenAddress,
    abi: puntosTokenAbi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  })) as bigint;

  return `🛍️ Tu cuenta en Bodegueando\nTienes ${formatSoles(points, ethPen)} en puntos acumulados por cashback.`;
}
