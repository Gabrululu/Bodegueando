"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useReadContract } from "wagmi";
import { QRCodeSVG } from "qrcode.react";
import { fiadoScoringAbi, fiadoScoringAddress, paymentRouterAddress } from "@/lib/contracts";
import { RISK_COLOR, RISK_LABEL, confianzaLabel, type AiRecommendation } from "@/lib/fiado";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { sendAndWait, useSmartAccountClient } from "@/lib/smartAccount";

/**
 * Vista del bodeguero: su propio código para cobrar, el interruptor de fiado, y
 * cuánto fiado le está ofreciendo la app a sus clientes ahora mismo (con opción de
 * refrescarlo con IA). Nada de esto lo ve un comprador — ver BuyerPanel.tsx.
 */
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

const cardClass = "flex flex-col gap-3 rounded-[20px] border border-black/10 bg-[#fffffc] p-5 shadow-sm";
const sectionTitleClass =
  "text-sm font-semibold uppercase tracking-wide text-[#6b6d64] [font-family:var(--font-bricolage)]";
const inputClass =
  "rounded-xl border border-black/15 bg-white px-3 py-2 text-center text-lg font-semibold tracking-widest text-[#0a0a0b] outline-none focus:border-black/35";
const primaryButtonClass =
  "cursor-pointer rounded-full px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const primaryButtonStyle = {
  background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)",
  boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
};
const outlineButtonClass =
  "cursor-pointer rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50";
const highlightBoxClass = "rounded-xl border border-black/5 bg-[#c9e26514] p-4";

export function BodegaOwnerPanel() {
  const { client: smartAccountClient, address, isLoading: isAccountLoading } = useSmartAccountClient();
  const [copied, setCopied] = useState(false);
  const [isTogglePending, setIsTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ recommendation: AiRecommendation; txHash: string | null } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [bodegaCode, setBodegaCode] = useState<string | null>(null);
  const [customerCodeInput, setCustomerCodeInput] = useState("");
  const [customerAddress, setCustomerAddress] = useState<Address | undefined>(undefined);
  const [isResolvingCustomer, setIsResolvingCustomer] = useState(false);
  const [customerNotFound, setCustomerNotFound] = useState(false);
  const [fiarAmountSoles, setFiarAmountSoles] = useState("10");
  const [isFiarSubmitting, setIsFiarSubmitting] = useState(false);
  const [fiarError, setFiarError] = useState<string | null>(null);
  const [fiarConfirmed, setFiarConfirmed] = useState(false);

  const { formatSoles, solesToEth } = useExchangeRate();

  useEffect(() => {
    if (!address) return;
    fetch("/api/bodega/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json())
      .then((data) => setBodegaCode(data.code ?? null))
      .catch(() => setBodegaCode(null));
  }, [address]);

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

  const totalOutstandingQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getTotalOutstanding",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const availableFiadoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAvailableFiado",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const refetchAll = () => {
    fiadoEnabledQuery.refetch();
    scoreQuery.refetch();
    limitQuery.refetch();
    aiInfoQuery.refetch();
    historyQuery.refetch();
    totalOutstandingQuery.refetch();
    availableFiadoQuery.refetch();
  };

  const isValidCustomerCodeFormat = /^\d{6}$/.test(customerCodeInput.trim());

  useEffect(() => {
    if (!isValidCustomerCodeFormat) return;
    const code = customerCodeInput.trim();
    let cancelled = false;

    async function resolve() {
      setIsResolvingCustomer(true);
      setCustomerNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.address) {
          setCustomerAddress(data.address as Address);
        } else {
          setCustomerAddress(undefined);
          setCustomerNotFound(true);
        }
      } catch {
        if (!cancelled) {
          setCustomerAddress(undefined);
          setCustomerNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolvingCustomer(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [customerCodeInput, isValidCustomerCodeFormat]);

  function handleCustomerCodeChange(value: string) {
    const trimmed = value.trim();
    setCustomerCodeInput(trimmed);
    if (!/^\d{6}$/.test(trimmed)) {
      setCustomerAddress(undefined);
      setCustomerNotFound(false);
    }
  }

  async function handleFiar() {
    if (!customerAddress || !fiadoScoringAddress || !smartAccountClient || !address) return;
    setIsFiarSubmitting(true);
    setFiarError(null);
    setFiarConfirmed(false);
    try {
      const ethAmount = solesToEth(Number(fiarAmountSoles || "0"));
      await sendAndWait(smartAccountClient, address, [
        {
          address: fiadoScoringAddress,
          abi: fiadoScoringAbi,
          functionName: "extendFiado",
          args: [customerAddress, parseEther(ethAmount.toFixed(18))],
        },
      ]);
      setFiarConfirmed(true);
      setCustomerCodeInput("");
      setCustomerAddress(undefined);
      refetchAll();
    } catch {
      setFiarError("No se pudo registrar el fiado. Revisa que tengas espacio disponible para fiar esa cantidad.");
    } finally {
      setIsFiarSubmitting(false);
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!fiadoScoringAddress || !smartAccountClient || !address) return;
    setIsTogglePending(true);
    setToggleError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: fiadoScoringAddress, abi: fiadoScoringAbi, functionName: "setFiadoEnabled", args: [enabled] },
      ]);
      refetchAll();
    } catch {
      setToggleError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setIsTogglePending(false);
    }
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
    if (!bodegaCode) return;
    await navigator.clipboard.writeText(bodegaCode);
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
    return (
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
        {isAccountLoading ? "Preparando tu cuenta…" : "Ingresa arriba para ver tu bodega."}
      </p>
    );
  }

  if (!contractsConfigured) {
    return (
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
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
      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Tu código para cobrar</h2>
        <p className="text-xs text-[#6b6d64]">Que tus clientes escaneen este código para pagarte.</p>
        {bodegaCode ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl border border-black/10 bg-white p-3">
              <QRCodeSVG
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/pagar/${bodegaCode}`}
                size={180}
              />
            </div>
            <p className="text-xs text-[#6b6d64]">O si no se puede escanear, este código:</p>
            <div className="flex items-center gap-2">
              <code className="rounded-lg bg-black/[0.05] px-3 py-2 text-lg font-semibold tracking-widest text-[#0a0a0b]">
                {bodegaCode}
              </code>
              <button onClick={handleCopy} className={outlineButtonClass}>
                {copied ? "¡Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#6b6d64]">Generando tu código…</p>
        )}
        <p className="text-xs text-[#6b6d64]">
          Pagos recibidos: {historyQuery.isLoading ? "…" : paymentCount}
        </p>
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Fiado para tus clientes</h2>
        <p className="text-xs text-[#6b6d64]">
          Tú decides si le fías a tus clientes. Puedes prenderlo o apagarlo cuando quieras.
        </p>
        <button
          onClick={() => handleToggle(!fiadoEnabled)}
          disabled={isTogglePending || fiadoEnabledQuery.isLoading}
          className={primaryButtonClass}
          style={primaryButtonStyle}
        >
          {isTogglePending
            ? "Guardando..."
            : fiadoEnabled
              ? "Fiado activado — desactivar"
              : "Activar fiado para mis clientes"}
        </button>
        {toggleError && <p className="text-xs text-red-500">{toggleError}</p>}

        {fiadoEnabled && (
          <div className="flex flex-col gap-3">
            <div className={highlightBoxClass}>
              <p className="text-xs text-[#6b6d64]">Fiado que le ofreces a cada cliente ahora mismo</p>
              <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                {limitQuery.isLoading ? "…" : formatSoles(limitEth)}
              </p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="text-[#6b6d64]">Confianza:</span>
                <span className={`font-medium ${confianza.color}`}>
                  {scoreQuery.isLoading ? "…" : confianza.text}
                </span>
                <span className="text-xs text-[#6b6d64]">
                  ({scoreQuery.isLoading ? "…" : score}/1000{aiAdjusted ? ", ajustado por IA" : ""})
                </span>
              </div>
            </div>

            <button onClick={handleAskAi} disabled={isAiLoading} className={outlineButtonClass}>
              {isAiLoading ? "Calculando..." : "Actualizar con IA"}
            </button>
            {aiError && <p className="text-xs text-red-500">{aiError}</p>}
            {aiResult && (
              <div className={`${highlightBoxClass} text-sm`}>
                <p className="text-[#0a0a0b]">
                  Nuevo límite:{" "}
                  <span className="font-medium">
                    {formatSoles(Number(aiResult.recommendation.creditLimitWei) / 1e18)}
                  </span>{" "}
                  · Riesgo:{" "}
                  <span className={`font-medium ${RISK_COLOR[aiResult.recommendation.riskLevel]}`}>
                    {RISK_LABEL[aiResult.recommendation.riskLevel]}
                  </span>
                </p>
                <p className="mt-1 text-[#55564f]">{aiResult.recommendation.rationale}</p>
                {aiResult.txHash && (
                  <a
                    href={`https://sepolia.arbiscan.io/tx/${aiResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-[#6b6d64] underline"
                  >
                    Ver comprobante ↗
                  </a>
                )}
              </div>
            )}

            <div className={highlightBoxClass}>
              <p className="text-xs text-[#6b6d64]">Fiado que ya diste (pendiente de cobro)</p>
              <p className="text-lg font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                {totalOutstandingQuery.isLoading
                  ? "…"
                  : formatSoles(Number((totalOutstandingQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18)}
              </p>
              <p className="mt-1 text-xs text-[#6b6d64]">
                Espacio disponible para fiar más:{" "}
                {availableFiadoQuery.isLoading
                  ? "…"
                  : formatSoles(Number((availableFiadoQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18)}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="customerCode" className="text-sm font-medium text-[#0a0a0b]">
                Fiar a un cliente
              </label>
              <input
                id="customerCode"
                inputMode="numeric"
                value={customerCodeInput}
                onChange={(e) => handleCustomerCodeChange(e.target.value)}
                placeholder="El código de 6 dígitos de tu cliente"
                className={inputClass}
              />
              {isResolvingCustomer && <p className="text-xs text-[#6b6d64]">Buscando...</p>}
              {customerNotFound && <p className="text-xs text-red-500">No encontramos ese código.</p>}

              {customerAddress && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#6b6d64]">S/</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      value={fiarAmountSoles}
                      onChange={(e) => setFiarAmountSoles(e.target.value)}
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                    />
                  </div>
                  <button onClick={handleFiar} disabled={isFiarSubmitting} className={primaryButtonClass} style={primaryButtonStyle}>
                    {isFiarSubmitting ? "Fiando..." : "Fiar a este cliente"}
                  </button>
                </>
              )}
              {fiarError && <p className="text-xs text-red-500">{fiarError}</p>}
              {fiarConfirmed && <p className="text-xs text-green-600">¡Listo! Ya quedó registrado el fiado ✓</p>}
            </div>
          </div>
        )}
      </section>

      {TELEGRAM_BOT_USERNAME && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Tu perfil por Telegram</h2>
          {telegramLinked ? (
            <>
              <p className="text-xs text-green-600">
                ✓ Vinculado — te avisamos cuando te paguen y puedes escribirle /perfil al bot para ver tus
                pagos y tu fiado cuando quieras.
              </p>
              <button onClick={handleTestNotify} className={outlineButtonClass}>
                Mandarme un mensaje de prueba
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[#6b6d64]">
                Vincula tu bodega con Telegram para recibir avisos cuando te paguen y consultar tus pagos y
                tu fiado escribiéndole /perfil al bot, cuando quieras.
              </p>
              {!linkCode ? (
                <button onClick={handleGenerateCode} disabled={isGeneratingCode} className={primaryButtonClass} style={primaryButtonStyle}>
                  {isGeneratingCode ? "Generando..." : "1. Generar mi código"}
                </button>
              ) : (
                <>
                  <p className="text-xs text-[#6b6d64]">Tu código (vale por 10 minutos):</p>
                  <p className="text-center text-2xl font-semibold tracking-widest text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                    {linkCode}
                  </p>
                  <a
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?text=${encodeURIComponent(`/vincular ${linkCode}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${primaryButtonClass} text-center`}
                    style={primaryButtonStyle}
                  >
                    2. Abrir el bot en Telegram y enviar el mensaje
                  </a>
                  <button onClick={handleCheckLinked} disabled={isLinkingTelegram} className={outlineButtonClass}>
                    {isLinkingTelegram ? "Revisando..." : "3. Ya lo mandé, vincular"}
                  </button>
                </>
              )}
            </>
          )}
          {telegramMessage && <p className="text-xs text-[#6b6d64]">{telegramMessage}</p>}
        </section>
      )}
    </div>
  );
}
