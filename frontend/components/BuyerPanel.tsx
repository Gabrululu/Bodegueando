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
import { confianzaLabel } from "@/lib/fiado";

/**
 * Vista del comprador: buscar una bodega por su código, ver si ofrece fiado (solo si
 * la bodega lo activó — ver BodegaOwnerPanel.tsx) y pagarle. El comprador no puede
 * prender/apagar el fiado de nadie ni pedirle a la IA que lo recalcule, esas acciones
 * son del bodeguero.
 */
export function BuyerPanel() {
  const { isConnected } = useAccount();
  const [bodega, setBodega] = useState("");
  const [amountEth, setAmountEth] = useState("0.001");

  const bodegaAddress = isAddress(bodega) ? (bodega as Address) : undefined;
  const contractsConfigured = Boolean(fiadoScoringAddress && paymentRouterAddress);

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

  useEffect(() => {
    if (isPayConfirmed) {
      fiadoEnabledQuery.refetch();
      scoreQuery.refetch();
      limitQuery.refetch();
      aiInfoQuery.refetch();

      // Best-effort: avisar por Telegram si la bodega vinculó su cuenta. No bloquea
      // ni muestra error al comprador si falla — el pago ya está confirmado on-chain.
      if (bodegaAddress) {
        fetch("/api/telegram/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bodegaAddress,
            text: `💰 Te pagaron ${amountEth} ETH en Bodegueando.`,
          }),
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayConfirmed]);

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
      {bodegaAddress && !fiadoEnabled && !fiadoEnabledQuery.isLoading && (
        <p className="text-xs text-zinc-400">Esta bodega no ofrece fiado por ahora.</p>
      )}

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
    </div>
  );
}
