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
import { useExchangeRate } from "@/lib/useExchangeRate";

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

/**
 * Vista del comprador: buscar una bodega por su código, ver si ofrece fiado (solo si
 * la bodega lo activó — ver BodegaOwnerPanel.tsx) y pagarle. El comprador no puede
 * prender/apagar el fiado de nadie ni pedirle a la IA que lo recalcule, esas acciones
 * son del bodeguero.
 */
export function BuyerPanel() {
  const { address, isConnected } = useAccount();
  const [bodega, setBodega] = useState("");
  const [amountSoles, setAmountSoles] = useState("13");
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);

  const { formatSoles, solesToEth } = useExchangeRate();

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
            text: `💰 Te pagaron S/ ${Number(amountSoles || "0").toFixed(2)} en Bodegueando.`,
          }),
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayConfirmed]);

  function handlePay() {
    if (!bodegaAddress || !paymentRouterAddress) return;
    const ethAmount = solesToEth(Number(amountSoles || "0"));
    writeContract({
      address: paymentRouterAddress,
      abi: paymentRouterAbi,
      functionName: "receivePayment",
      args: [bodegaAddress],
      value: parseEther(ethAmount.toFixed(18)),
    });
  }

  useEffect(() => {
    if (!address) return;
    fetch(`/api/telegram/status?bodegaAddress=${address}`)
      .then((res) => res.json())
      .then((data) => setTelegramLinked(Boolean(data.linked)))
      .catch(() => setTelegramLinked(null));
  }, [address]);

  async function handleGenerateCode() {
    if (!address) return;
    setIsGeneratingCode(true);
    setTelegramMessage(null);
    try {
      const res = await fetch("/api/telegram/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      setLinkCode(data.code ?? null);
    } catch {
      setTelegramMessage("No pudimos generar el código. Intenta de nuevo.");
    } finally {
      setIsGeneratingCode(false);
    }
  }

  async function handleCheckLinked() {
    if (!address) return;
    setIsLinkingTelegram(true);
    setTelegramMessage(null);
    try {
      const res = await fetch(`/api/telegram/status?bodegaAddress=${address}`);
      const data = await res.json();
      setTelegramLinked(Boolean(data.linked));
      setTelegramMessage(
        data.linked
          ? "¡Listo! Vinculado."
          : "Todavía no te veo vinculado. Manda el mensaje al bot y volvé a intentar.",
      );
    } catch {
      setTelegramMessage("No pudimos revisar. Intenta de nuevo.");
    } finally {
      setIsLinkingTelegram(false);
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
              {limitQuery.isLoading ? "…" : formatSoles(limitEth)}
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">S/</span>
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={amountSoles}
              onChange={(e) => setAmountSoles(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
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

      {isConnected && TELEGRAM_BOT_USERNAME && (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Tus puntos por Telegram
          </h2>
          {telegramLinked ? (
            <p className="text-xs text-green-600">
              ✓ Vinculado — escríbele /perfil al bot cuando quieras ver tus puntos acumulados.
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Vincula tu cuenta con Telegram para consultar tus puntos escribiéndole /perfil al bot.
              </p>
              {!linkCode ? (
                <button
                  onClick={handleGenerateCode}
                  disabled={isGeneratingCode}
                  className="cursor-pointer rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  {isGeneratingCode ? "Generando..." : "1. Generar mi código"}
                </button>
              ) : (
                <>
                  <p className="text-xs text-zinc-500">Tu código (vale por 10 minutos):</p>
                  <p className="text-center text-2xl font-semibold tracking-widest">{linkCode}</p>
                  <a
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?text=${encodeURIComponent(`/vincular ${linkCode}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer rounded-md bg-black px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                  >
                    2. Abrir el bot en Telegram y enviar el mensaje
                  </a>
                  <button
                    onClick={handleCheckLinked}
                    disabled={isLinkingTelegram}
                    className="cursor-pointer rounded-md border border-zinc-400 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-900"
                  >
                    {isLinkingTelegram ? "Revisando..." : "3. Ya lo mandé, vincular"}
                  </button>
                </>
              )}
            </>
          )}
          {telegramMessage && <p className="text-xs text-zinc-500">{telegramMessage}</p>}
        </section>
      )}
    </div>
  );
}
