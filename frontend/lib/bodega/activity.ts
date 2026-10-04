"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  http,
  numberToHex,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { fiadoScoringAbi, fiadoScoringAddress, paymentRouterAddress, STABLECOIN_DECIMALS } from "@/lib/contracts";

/**
 * Historial completo leído de los eventos on-chain, sin backend ni indexador: los contratos ya
 * emiten la bodega como topic indexado, así que basta `eth_getLogs` filtrando por ella.
 *
 * - Ventas: `PaymentRouter.PaymentReceived` del router actual (monto en USDG, quién pagó y la
 *   fecha del bloque). `FiadoScoring.getPaymentHistory` solo guarda los últimos 12 pagos.
 * - Quién te debe: `FiadoScoring.FiadoExtended`/`FiadoRepaid` para saber a qué clientes se les
 *   fió alguna vez; la deuda actual se lee de `getFiadoDebt`, la fuente de verdad.
 *
 * El RPC de Arbitrum Sepolia acepta como máximo 10M bloques por consulta (~29 días), así que el
 * rango se parte en ventanas que se piden en paralelo. Si se conoce el bloque de despliegue
 * (`NEXT_PUBLIC_CONTRACTS_DEPLOY_BLOCK`), se lee desde ahí; si no, los últimos ~6 tramos.
 */

const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const deployBlockEnv = process.env.NEXT_PUBLIC_CONTRACTS_DEPLOY_BLOCK;
const WINDOW = BigInt(9_000_000);
const DEFAULT_WINDOWS = 6;

// batch: agrupa en una sola petición HTTP las lecturas de bloques del fallback de fechas.
const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl, { batch: true }) });

const paymentReceivedEvent = parseAbiItem(
  "event PaymentReceived(address indexed payer, address indexed bodega, uint256 amount, uint256 cashback)",
);
const fiadoExtendedEvent = parseAbiItem(
  "event FiadoExtended(address indexed bodega, address indexed customer, uint256 amount)",
);
const fiadoRepaidEvent = parseAbiItem("event FiadoRepaid(address indexed bodega, address indexed customer, uint256 amount)");

async function blockWindows(): Promise<Array<{ fromBlock: bigint; toBlock: bigint }>> {
  const head = await client.getBlockNumber();
  const start = deployBlockEnv ? BigInt(deployBlockEnv) : head - WINDOW * BigInt(DEFAULT_WINDOWS);
  const windows: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let from = start > BigInt(0) ? start : BigInt(0); from <= head; from += WINDOW) {
    const to = from + WINDOW - BigInt(1);
    windows.push({ fromBlock: from, toBlock: to > head ? head : to });
  }
  return windows;
}

type RawLog = { data: Hex; topics: [Hex, ...Hex[]]; transactionHash: Hex; blockNumber: Hex; blockTimestamp?: Hex };

/**
 * `eth_getLogs` directo en vez de `client.getLogs`: el nodo de Arbitrum devuelve `blockTimestamp`
 * en cada log, que el formateador de viem descarta. No siempre viene poblado (en logs viejos llega
 * como `0x0`), así que para esos se pide la fecha del bloque — una vez por bloque, en lote.
 */
async function getLogsWithTimestamps<const E extends AbiEvent>(
  address: Address,
  event: E,
  indexedArgs: Record<string, Address>,
) {
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args: indexedArgs } as never);
  const windows = await blockWindows();
  const chunks = await Promise.all(
    windows.map(
      (w) =>
        client.request({
          method: "eth_getLogs",
          params: [{ address, topics, fromBlock: numberToHex(w.fromBlock), toBlock: numberToHex(w.toBlock) }],
        } as never) as Promise<RawLog[]>,
    ),
  );
  const logs = chunks.flat();

  const missing = [...new Set(logs.filter((l) => !l.blockTimestamp || BigInt(l.blockTimestamp) === BigInt(0)).map((l) => l.blockNumber))];
  const blocks = await Promise.all(missing.map((n) => client.getBlock({ blockNumber: BigInt(n) })));
  const timestampByBlock = Object.fromEntries(missing.map((n, i) => [n, Number(blocks[i].timestamp)]));

  return logs.map((log) => {
    const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics }) as { args: Record<string, unknown> };
    const fromLog = log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : 0;
    return {
      args: decoded.args,
      timestamp: fromLog || timestampByBlock[log.blockNumber] || 0,
      txHash: log.transactionHash,
    };
  });
}

export type Sale = { payer: Address; amountUsd: number; timestamp: number; txHash: string };

/** Todas las ventas cobradas por el router actual, de la más nueva a la más vieja. */
export function useSalesHistory(bodega: Address | null) {
  return useQuery({
    queryKey: ["bodega-sales", paymentRouterAddress, bodega],
    enabled: Boolean(bodega && paymentRouterAddress),
    staleTime: 30_000,
    queryFn: async (): Promise<Sale[]> => {
      const logs = await getLogsWithTimestamps(paymentRouterAddress as Address, paymentReceivedEvent, {
        bodega: bodega as Address,
      });
      return logs
        .map((log) => ({
          payer: log.args.payer as Address,
          amountUsd: Number((log.args.amount as bigint | undefined) ?? BigInt(0)) / 10 ** STABLECOIN_DECIMALS,
          timestamp: log.timestamp,
          txHash: log.txHash,
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
    },
  });
}

export type Debtor = { customer: Address; debtUsd: number; lastActivity: number; lastRepayment: number | null };

/** Debajo de esto se considera saldado (restos de cuando el fiado se registraba en ETH-wei). */
const DUST_USD = 0.005;

/** Clientes que hoy le deben algo a esta bodega, del que más debe al que menos. */
export function useDebtors(bodega: Address | null) {
  return useQuery({
    queryKey: ["bodega-debtors", fiadoScoringAddress, bodega],
    enabled: Boolean(bodega && fiadoScoringAddress),
    staleTime: 30_000,
    queryFn: async (): Promise<Debtor[]> => {
      const [extended, repaid] = await Promise.all(
        [fiadoExtendedEvent, fiadoRepaidEvent].map((event) =>
          getLogsWithTimestamps(fiadoScoringAddress as Address, event, { bodega: bodega as Address }),
        ),
      );

      const activity: Record<string, { customer: Address; lastActivity: number; lastRepayment: number | null }> = {};
      for (const log of extended) {
        const customer = log.args.customer as Address;
        const key = customer.toLowerCase();
        const ts = log.timestamp;
        activity[key] ??= { customer, lastActivity: 0, lastRepayment: null };
        activity[key].lastActivity = Math.max(activity[key].lastActivity, ts);
      }
      for (const log of repaid) {
        const customer = log.args.customer as Address;
        const key = customer.toLowerCase();
        const ts = log.timestamp;
        activity[key] ??= { customer, lastActivity: 0, lastRepayment: null };
        activity[key].lastActivity = Math.max(activity[key].lastActivity, ts);
        activity[key].lastRepayment = Math.max(activity[key].lastRepayment ?? 0, ts);
      }

      const customers = Object.values(activity);
      if (customers.length === 0) return [];

      const debts = await client.multicall({
        contracts: customers.map((c) => ({
          address: fiadoScoringAddress as Address,
          abi: fiadoScoringAbi as never,
          functionName: "getFiadoDebt",
          args: [bodega, c.customer],
        })),
      });

      return customers
        .map((c, i) => ({
          ...c,
          debtUsd: debts[i].status === "success" ? Number(debts[i].result as bigint) / 1e18 : 0,
        }))
        .filter((d) => d.debtUsd > DUST_USD)
        .sort((a, b) => b.debtUsd - a.debtUsd);
    },
  });
}

/** Suma de ventas por día para los últimos `days` días (incluye hoy), en zona horaria local. */
export function dailyTotals(sales: Sale[], days: number): Array<{ day: Date; totalUsd: number; count: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (days - 1 - i));
    return { day, totalUsd: 0, count: 0 };
  });
  const firstDay = buckets[0].day.getTime();
  for (const sale of sales) {
    const index = Math.floor((sale.timestamp * 1000 - firstDay) / 86_400_000);
    if (index >= 0 && index < days) {
      buckets[index].totalUsd += sale.amountUsd;
      buckets[index].count += 1;
    }
  }
  return buckets;
}
