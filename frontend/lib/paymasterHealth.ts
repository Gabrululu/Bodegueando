import { createPublicClient, formatEther, http, parseAbi, parseEther, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { puntosPaymasterAddress } from "./contracts";

/**
 * Server-only: los dos datos de PuntosPaymaster que alguien tiene que mantener a mano.
 *
 * - **Depósito de gas en el EntryPoint.** Se recarga a mano (`deposit()`); si se acaba, los
 *   pagos empiezan a fallar.
 * - **`puntosPerEth`** (precio ETH/USD con 18 decimales) con el que se cobra el gas en PUNTOS.
 *   `setPuntosPerEth` es `onlyOwner` — y el owner también puede retirar PUNTOS del contrato —,
 *   así que no se actualiza solo desde el servidor (habría que dejar esa clave en Vercel): se
 *   compara con el precio de mercado y se avisa cuando se desvía demasiado.
 *
 * Lo usa el cron diario app/api/cron/paymaster-health. scripts/check-paymaster-balance.mjs
 * sigue existiendo para chequear el depósito a mano desde la terminal.
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];
const DEPOSIT_THRESHOLD_ETH = process.env.PAYMASTER_BALANCE_ALERT_THRESHOLD_ETH || "0.01";
const RATE_DRIFT_ALERT_PCT = Number(process.env.PUNTOS_PER_ETH_DRIFT_ALERT_PCT) || 10;
const ETH_USD_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

const entryPointAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const paymasterAbi = parseAbi(["function puntosPerEth() view returns (uint256)"]);

export type PaymasterHealth = {
  paymaster: Address;
  depositEth: string;
  depositThresholdEth: string;
  depositLow: boolean;
  /** USD por ETH que usa el contrato hoy. */
  contractEthUsd: number;
  /** null si el precio de mercado no se pudo leer — ese chequeo se salta, no falla todo. */
  marketEthUsd: number | null;
  rateDriftPct: number | null;
  rateStale: boolean;
};

async function fetchMarketEthUsd(): Promise<number | null> {
  try {
    const res = await fetch(ETH_USD_URL, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    const usd = Number((await res.json())?.ethereum?.usd);
    return usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

export async function checkPaymasterHealth(): Promise<PaymasterHealth | null> {
  if (!puntosPaymasterAddress) return null;
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

  const [depositWei, puntosPerEth, marketEthUsd] = await Promise.all([
    client.readContract({
      address: entryPoint07Address,
      abi: entryPointAbi,
      functionName: "balanceOf",
      args: [puntosPaymasterAddress],
    }),
    client.readContract({ address: puntosPaymasterAddress, abi: paymasterAbi, functionName: "puntosPerEth" }),
    fetchMarketEthUsd(),
  ]);

  const contractEthUsd = Number(formatEther(puntosPerEth));
  const rateDriftPct = marketEthUsd ? ((contractEthUsd - marketEthUsd) / marketEthUsd) * 100 : null;

  return {
    paymaster: puntosPaymasterAddress,
    depositEth: formatEther(depositWei),
    depositThresholdEth: DEPOSIT_THRESHOLD_ETH,
    depositLow: depositWei < parseEther(DEPOSIT_THRESHOLD_ETH),
    contractEthUsd,
    marketEthUsd,
    rateDriftPct,
    rateStale: rateDriftPct !== null && Math.abs(rateDriftPct) > RATE_DRIFT_ALERT_PCT,
  };
}

/** Texto de alerta para quien opera la app, o null si está todo bien. */
export function paymasterAlertText(health: PaymasterHealth): string | null {
  const problems: string[] = [];
  if (health.depositLow) {
    problems.push(
      `• Depósito de gas bajo: ${health.depositEth} ETH (umbral ${health.depositThresholdEth} ETH). ` +
        `Recárgalo con deposit() en el EntryPoint antes de que los pagos empiecen a fallar.`,
    );
  }
  if (health.rateStale && health.marketEthUsd !== null && health.rateDriftPct !== null) {
    const newRate = `${Math.round(health.marketEthUsd)}e18`;
    problems.push(
      `• puntosPerEth desactualizado: el contrato usa US$ ${health.contractEthUsd.toFixed(0)}/ETH y el mercado ` +
        `está en US$ ${health.marketEthUsd.toFixed(0)} (${health.rateDriftPct.toFixed(1)}%). ` +
        `Actualízalo con: cast send ${health.paymaster} "setPuntosPerEth(uint256)" ${newRate}`,
    );
  }
  return problems.length ? `⚠️ PuntosPaymaster necesita atención\n\n${problems.join("\n\n")}` : null;
}
