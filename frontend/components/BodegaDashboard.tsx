"use client";

import { useEffect, useState } from "react";
import { isAddress, parseEther, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  fiadoScoringAbi,
  fiadoScoringAddress,
  paymentRouterAbi,
  paymentRouterAddress,
} from "@/lib/contracts";

interface AiRecommendation {
  score: number;
  creditLimitWei: string;
  riskLevel: "low" | "medium" | "high";
  rationale: string;
}

const RISK_LABEL: Record<AiRecommendation["riskLevel"], string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
};

const RISK_COLOR: Record<AiRecommendation["riskLevel"], string> = {
  low: "text-green-600",
  medium: "text-amber-600",
  high: "text-red-600",
};

function confianzaLabel(score: number): { text: string; color: string } {
  if (score >= 700) return { text: "Alta", color: "text-green-600" };
  if (score >= 300) return { text: "Media", color: "text-amber-600" };
  return { text: "Recién empezando", color: "text-zinc-500" };
}

/**
 * Panel principal: buscar una bodega, ver su fiado disponible (si esa bodega lo ofrece),
 * pagarle, y (opcional) pedirle a la IA que recalcule el límite. El texto está pensado
 * para alguien que nunca usó una wallet ni sabe qué es blockchain — solo quiere pagar.
 *
 * El fiado no es automático: cada bodega lo prende o apaga (`FiadoScoring.setFiadoEnabled`,
 * solo la bodega misma puede tocar su propio flag). Si está apagado, un cliente no ve
 * nada de fiado — solo puede pagar. Si la wallet conectada es la misma que la bodega que
 * se está mirando, aparece además el interruptor para prenderlo/apagarlo.
 */
export function BodegaDashboard() {
  const { address, isConnected } = useAccount();
  const [bodega, setBodega] = useState("");
  const [amountEth, setAmountEth] = useState("0.001");
  const [aiResult, setAiResult] = useState<{ recommendation: AiRecommendation; txHash: string | null } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const bodegaAddress = isAddress(bodega) ? (bodega as Address) : undefined;
  const contractsConfigured = Boolean(fiadoScoringAddress && paymentRouterAddress);
  const isBodegaOwner = Boolean(
    isConnected && address && bodegaAddress && address.toLowerCase() === bodegaAddress.toLowerCase(),
  );

  const fiadoEnabledQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "isFiadoEnabled",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress) },
  });
  const fiadoEnabled = fiadoEnabledQuery.data === true;

  const scoreQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getScore",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress && fiadoEnabled) },
  });

  const limitQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getCreditLimit",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress && fiadoEnabled) },
  });

  const aiInfoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAiAdjustmentInfo",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress && fiadoEnabled) },
  });

  const { writeContract, data: payTxHash, isPending: isPaySubmitting, error: payError } = useWriteContract();
  const { isLoading: isPayConfirming, isSuccess: isPayConfirmed } = useWaitForTransactionReceipt({ hash: payTxHash });

  const {
    writeContract: writeToggle,
    data: toggleTxHash,
    isPending: isTogglePending,
    error: toggleError,
  } = useWriteContract();
  const { isLoading: isToggleConfirming } = useWaitForTransactionReceipt({ hash: toggleTxHash });

  const refetchAll = () => {
    fiadoEnabledQuery.refetch();
    scoreQuery.refetch();
    limitQuery.refetch();
    aiInfoQuery.refetch();
  };

  useEffect(() => {
    if (isPayConfirmed) refetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayConfirmed]);

  useEffect(() => {
    if (toggleTxHash && !isToggleConfirming) refetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToggleConfirming]);

  function handlePay() {
    if (!bodegaAddress || !paymentRouterAddress) return;
    writeContract({
      address: paymentRouterAddress,
      abi: paymentRouterAbi,
      functionName: "receivePayment",
      args: [bodegaAddress],
      value: parseEther(amountEth || "0"),
    });
  }

  function handleToggleFiado(enabled: boolean) {
    if (!fiadoScoringAddress) return;
    writeToggle({
      address: fiadoScoringAddress,
      abi: fiadoScoringAbi,
      functionName: "setFiadoEnabled",
      args: [enabled],
    });
  }

  async function handleAskAi() {
    if (!bodegaAddress) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch("/api/fiado-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodegaAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Algo falló al calcular tu fiado");
      setAiResult(data);
      refetchAll();
    } catch {
      setAiError("No pudimos calcular tu fiado ahora mismo. Intenta de nuevo en un momento.");
    } finally {
      setIsAiLoading(false);
    }
  }

  if (!contractsConfigured) {
    return (
      <p className="max-w-md text-center text-sm text-zinc-500">
        La app todavía no está conectada a los contratos. Avísale a soporte.
      </p>
    );
  }

  const score = Number((scoreQuery.data as bigint | undefined) ?? BigInt(0));
  const limitEth = Number((limitQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18;
  const aiAdjusted = Boolean((aiInfoQuery.data as [boolean, bigint] | undefined)?.[0]);
  const confianza = confianzaLabel(score);

  const payDisabledReason = !bodegaAddress
    ? "Escribe el código de la bodega para poder pagar."
    : !isConnected
      ? "Ingresa arriba para poder pagar."
      : null;

  return (
    <div className="flex w-full max-w-md flex-col gap-8 text-left">
      {/* Código de bodega — compartido por todo lo de abajo */}
      <div className="flex flex-col gap-1">
        <label htmlFor="bodega" className="text-sm font-medium">
          Código de la bodega
        </label>
        <input
          id="bodega"
          value={bodega}
          onChange={(e) => setBodega(e.target.value.trim())}
          placeholder="Pégalo o escanéalo del cartel de la bodega"
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-zinc-700"
        />
        {bodega && !bodegaAddress && (
          <p className="text-xs text-red-500">Ese código no es válido, revisa que esté completo.</p>
        )}
      </div>

      {bodegaAddress && fiadoEnabled && (
        <div className="flex flex-col gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
          <div>
            <p className="text-xs text-zinc-500">Fiado disponible en esta bodega</p>
            <p className="text-2xl font-semibold">
              {limitQuery.isLoading ? "…" : `${limitEth} ETH`}
              <span className="ml-1 text-xs font-normal text-zinc-500">(moneda de prueba)</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500">Confianza:</span>
            <span className={`font-medium ${confianza.color}`}>
              {scoreQuery.isLoading ? "…" : confianza.text}
            </span>
            <span className="text-xs text-zinc-500">
              ({scoreQuery.isLoading ? "…" : score}/1000{aiAdjusted ? ", ajustado por IA" : ""})
            </span>
          </div>
        </div>
      )}
      {bodegaAddress && !fiadoEnabled && !fiadoEnabledQuery.isLoading && !isBodegaOwner && (
        <p className="text-xs text-zinc-400">Esta bodega no ofrece fiado por ahora.</p>
      )}

      {/* Sección 1: pagar — acción principal */}
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Pagar en la bodega
        </h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="amount" className="text-sm font-medium">
            ¿Cuánto vas a pagar?
          </label>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.0001"
            value={amountEth}
            onChange={(e) => setAmountEth(e.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
          <p className="text-xs text-zinc-500">En moneda de prueba (ETH de testnet)</p>
        </div>

        <button
          onClick={handlePay}
          disabled={!isConnected || !bodegaAddress || isPaySubmitting || isPayConfirming}
          className="cursor-pointer rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isPaySubmitting || isPayConfirming ? "Pagando..." : "Pagar"}
        </button>
        {payDisabledReason && <p className="text-xs text-zinc-500">{payDisabledReason}</p>}
        {payError && <p className="text-xs text-red-500">No se pudo completar el pago. Intenta de nuevo.</p>}
        {isPayConfirmed && <p className="text-xs text-green-600">¡Listo! Tu pago se registró ✓</p>}
      </section>

      {/* Sección solo visible para la bodega dueña del código que se está mirando */}
      {isBodegaOwner && (
        <section className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 p-5 dark:border-zinc-700">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Configuración de tu bodega
          </h2>
          <p className="text-xs text-zinc-500">
            Vos decidís si le fías a tus clientes. Podés prenderlo o apagarlo cuando quieras.
          </p>
          <button
            onClick={() => handleToggleFiado(!fiadoEnabled)}
            disabled={isTogglePending || isToggleConfirming || fiadoEnabledQuery.isLoading}
            className="cursor-pointer rounded-md border border-zinc-400 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-900"
          >
            {isTogglePending || isToggleConfirming
              ? "Guardando..."
              : fiadoEnabled
                ? "Fiado activado — desactivar"
                : "Activar fiado para mis clientes"}
          </button>
          {toggleError && <p className="text-xs text-red-500">No se pudo guardar. Intenta de nuevo.</p>}
        </section>
      )}

      {/* Sección 2: fiado / IA — solo si esta bodega ofrece fiado */}
      {fiadoEnabled && (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Tu fiado en esta bodega
          </h2>
          <p className="text-xs text-zinc-500">
            Revisa cuánto fiado te podemos dar según tu historial de pagos en esta bodega.
          </p>

          <button
            onClick={handleAskAi}
            disabled={!bodegaAddress || isAiLoading}
            className="cursor-pointer rounded-md border border-zinc-400 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-900"
          >
            {isAiLoading ? "Calculando..." : "Actualizar mi límite de fiado"}
          </button>
          {aiError && <p className="text-xs text-red-500">{aiError}</p>}
          {aiResult && (
            <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <p>
                Nuevo límite:{" "}
                <span className="font-medium">{Number(aiResult.recommendation.creditLimitWei) / 1e18} ETH</span>{" "}
                · Riesgo:{" "}
                <span className={`font-medium ${RISK_COLOR[aiResult.recommendation.riskLevel]}`}>
                  {RISK_LABEL[aiResult.recommendation.riskLevel]}
                </span>
              </p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{aiResult.recommendation.rationale}</p>
              {aiResult.txHash && (
                <a
                  href={`https://sepolia.arbiscan.io/tx/${aiResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs text-zinc-500 underline"
                >
                  Ver comprobante ↗
                </a>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
