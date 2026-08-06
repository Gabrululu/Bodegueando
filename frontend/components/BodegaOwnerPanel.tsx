"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { fiadoScoringAbi, fiadoScoringAddress, paymentRouterAddress } from "@/lib/contracts";
import { RISK_COLOR, RISK_LABEL, confianzaLabel, type AiRecommendation } from "@/lib/fiado";
import { useExchangeRate } from "@/lib/useExchangeRate";

/**
 * Vista del bodeguero: su propio código para cobrar, el interruptor de fiado, y
 * cuánto fiado le está ofreciendo la app a sus clientes ahora mismo (con opción de
 * refrescarlo con IA). Nada de esto lo ve un comprador — ver BuyerPanel.tsx.
 */
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

export function BodegaOwnerPanel() {
  const { address } = useAccount();
  const [copied, setCopied] = useState(false);
  const [aiResult, setAiResult] = useState<{ recommendation: AiRecommendation; txHash: string | null } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);

  const { formatSoles } = useExchangeRate();

  const contractsConfigured = Boolean(fiadoScoringAddress && paymentRouterAddress);

  const fiadoEnabledQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "isFiadoEnabled",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });
  const fiadoEnabled = fiadoEnabledQuery.data === true;

  const scoreQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getScore",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const limitQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getCreditLimit",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const aiInfoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAiAdjustmentInfo",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const historyQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getPaymentHistory",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

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
    historyQuery.refetch();
  };

  useEffect(() => {
    if (toggleTxHash && !isToggleConfirming) refetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToggleConfirming]);

  function handleToggle(enabled: boolean) {
    if (!fiadoScoringAddress) return;
    writeToggle({
      address: fiadoScoringAddress,
      abi: fiadoScoringAbi,
      functionName: "setFiadoEnabled",
      args: [enabled],
    });
  }

  async function handleAskAi() {
    if (!address) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch("/api/fiado-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodegaAddress: address }),
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

  async function handleCopy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  async function handleTestNotify() {
    if (!address) return;
    setTelegramMessage(null);
    try {
      const res = await fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodegaAddress: address,
          text: "🔔 Notificaciones de Bodegueando activadas. Acá vas a ver tus pagos.",
        }),
      });
      const data = await res.json();
      setTelegramMessage(data.sent ? "Mensaje de prueba enviado ✓" : "No se pudo enviar. Revisa la vinculación.");
    } catch {
      setTelegramMessage("No se pudo enviar. Intenta de nuevo.");
    }
  }

  if (!address) {
    return <p className="max-w-md text-center text-sm text-zinc-500">Ingresa arriba para ver tu bodega.</p>;
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
  const paymentCount = ((historyQuery.data as [bigint[], bigint[]] | undefined)?.[0] ?? []).length;

  return (
    <div className="flex w-full max-w-md flex-col gap-8 text-left">
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Tu código para cobrar
        </h2>
        <p className="text-xs text-zinc-500">Compártelo con tus clientes para que te paguen.</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-900">
            {address}
          </code>
          <button
            onClick={handleCopy}
            className="cursor-pointer rounded-md border border-zinc-400 px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900"
          >
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Pagos recibidos: {historyQuery.isLoading ? "…" : paymentCount}
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Fiado para tus clientes
        </h2>
        <p className="text-xs text-zinc-500">
          Tú decides si le fías a tus clientes. Puedes prenderlo o apagarlo cuando quieras.
        </p>
        <button
          onClick={() => handleToggle(!fiadoEnabled)}
          disabled={isTogglePending || isToggleConfirming || fiadoEnabledQuery.isLoading}
          className="cursor-pointer rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isTogglePending || isToggleConfirming
            ? "Guardando..."
            : fiadoEnabled
              ? "Fiado activado — desactivar"
              : "Activar fiado para mis clientes"}
        </button>
        {toggleError && <p className="text-xs text-red-500">No se pudo guardar. Intenta de nuevo.</p>}

        {fiadoEnabled && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">Fiado que le ofreces a cada cliente ahora mismo</p>
              <p className="text-2xl font-semibold">
                {limitQuery.isLoading ? "…" : formatSoles(limitEth)}
              </p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="text-zinc-500">Confianza:</span>
                <span className={`font-medium ${confianza.color}`}>
                  {scoreQuery.isLoading ? "…" : confianza.text}
                </span>
                <span className="text-xs text-zinc-500">
                  ({scoreQuery.isLoading ? "…" : score}/1000{aiAdjusted ? ", ajustado por IA" : ""})
                </span>
              </div>
            </div>

            <button
              onClick={handleAskAi}
              disabled={isAiLoading}
              className="cursor-pointer rounded-md border border-zinc-400 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-900"
            >
              {isAiLoading ? "Calculando..." : "Actualizar con IA"}
            </button>
            {aiError && <p className="text-xs text-red-500">{aiError}</p>}
            {aiResult && (
              <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                <p>
                  Nuevo límite:{" "}
                  <span className="font-medium">
                    {formatSoles(Number(aiResult.recommendation.creditLimitWei) / 1e18)}
                  </span>{" "}
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
          </div>
        )}
      </section>

      {TELEGRAM_BOT_USERNAME && (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Tu perfil por Telegram
          </h2>
          {telegramLinked ? (
            <>
              <p className="text-xs text-green-600">
                ✓ Vinculado — te avisamos cuando te paguen y puedes escribirle /perfil al bot para ver tus
                pagos y tu fiado cuando quieras.
              </p>
              <button
                onClick={handleTestNotify}
                className="cursor-pointer rounded-md border border-zinc-400 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900"
              >
                Mandarme un mensaje de prueba
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Vincula tu bodega con Telegram para recibir avisos cuando te paguen y consultar tus pagos y
                tu fiado escribiéndole /perfil al bot, cuando quieras.
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
