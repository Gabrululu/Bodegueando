"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useReadContract } from "wagmi";
import {
  fiadoScoringAbi,
  fiadoScoringAddress,
  paymentRouterAbi,
  paymentRouterAddress,
  beneficioTokenAbi,
  beneficioTokenAddress,
} from "@/lib/contracts";
import { confianzaLabel } from "@/lib/fiado";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { sendAndWait, useSmartAccountClient } from "@/lib/smartAccount";

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
const highlightBoxClass = "flex flex-col gap-3 rounded-xl border border-black/5 bg-[#c9e26514] p-4";

/**
 * Vista del comprador: buscar una bodega por su código, ver si ofrece fiado (solo si
 * la bodega lo activó — ver BodegaOwnerPanel.tsx) y pagarle. El comprador no puede
 * prender/apagar el fiado de nadie ni pedirle a la IA que lo recalcule, esas acciones
 * son del bodeguero.
 */
export function BuyerPanel({ initialCode }: { initialCode?: string } = {}) {
  const { client: smartAccountClient, address, isLoading: isAccountLoading } = useSmartAccountClient();
  const isConnected = Boolean(address);
  const [bodegaCodeInput, setBodegaCodeInput] = useState(initialCode ?? "");
  const [bodegaAddress, setBodegaAddress] = useState<Address | undefined>(undefined);
  const [isResolvingCode, setIsResolvingCode] = useState(false);
  const [codeNotFound, setCodeNotFound] = useState(false);
  const [amountSoles, setAmountSoles] = useState("13");
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isPaySubmitting, setIsPaySubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [isPayConfirmed, setIsPayConfirmed] = useState(false);

  const { formatSoles, solesToEth, ethPen } = useExchangeRate();
  const [myCode, setMyCode] = useState<string | null>(null);
  const [repayAmountSoles, setRepayAmountSoles] = useState("");
  const [isRepaySubmitting, setIsRepaySubmitting] = useState(false);
  const [repayError, setRepayError] = useState<string | null>(null);
  const [isRepayConfirmed, setIsRepayConfirmed] = useState(false);
  const [benefitAmountSoles, setBenefitAmountSoles] = useState("");
  const [isRedeemSubmitting, setIsRedeemSubmitting] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [isRedeemConfirmed, setIsRedeemConfirmed] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);

  const contractsConfigured = Boolean(fiadoScoringAddress && paymentRouterAddress);

  const isValidCodeFormat = /^\d{6}$/.test(bodegaCodeInput.trim());

  useEffect(() => {
    if (!isValidCodeFormat) return;
    const code = bodegaCodeInput.trim();
    let cancelled = false;

    async function resolve() {
      setIsResolvingCode(true);
      setCodeNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.address) {
          setBodegaAddress(data.address as Address);
        } else {
          setBodegaAddress(undefined);
          setCodeNotFound(true);
        }
      } catch {
        if (!cancelled) {
          setBodegaAddress(undefined);
          setCodeNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolvingCode(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [bodegaCodeInput, isValidCodeFormat]);

  function handleBodegaCodeChange(value: string) {
    const trimmed = value.trim();
    setBodegaCodeInput(trimmed);
    if (!/^\d{6}$/.test(trimmed)) {
      setBodegaAddress(undefined);
      setCodeNotFound(false);
    }
  }

  const isBodegaQuery = useReadContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && paymentRouterAddress) },
  });
  const isRealBodega = isBodegaQuery.data === true;
  const codeIsNotABodega = Boolean(bodegaAddress) && !isBodegaQuery.isLoading && !isRealBodega;

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

  const debtQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getFiadoDebt",
    args: bodegaAddress && address ? [bodegaAddress, address] : undefined,
    query: { enabled: Boolean(bodegaAddress && address && fiadoScoringAddress && fiadoEnabled) },
  });
  const debtWei = (debtQuery.data as bigint | undefined) ?? BigInt(0);

  useEffect(() => {
    if (debtWei > BigInt(0) && repayAmountSoles === "") {
      setRepayAmountSoles(((Number(debtWei) / 1e18) * ethPen).toFixed(2));
    }
  }, [debtWei, ethPen, repayAmountSoles]);

  const benefitBalanceQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && beneficioTokenAddress) },
  });
  const benefitExpiryQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "expiresAt",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && beneficioTokenAddress) },
  });
  const benefitBalanceWei = (benefitBalanceQuery.data as bigint | undefined) ?? BigInt(0);
  const benefitExpiresAt = Number((benefitExpiryQuery.data as bigint | undefined) ?? BigInt(0));
  // No se pre-valida el vencimiento acá: BeneficioToken._update ya lo hace cumplir on-chain
  // (revierte con BenefitExpired), así que si el beneficio venció, el intento de pago
  // simplemente revierte y se muestra el mismo mensaje de error genérico de abajo.
  const hasBenefit = benefitBalanceWei > BigInt(0);

  useEffect(() => {
    if (hasBenefit && bodegaAddress && benefitAmountSoles === "") {
      setBenefitAmountSoles((Number(benefitBalanceWei) / 1e18).toFixed(2));
    }
  }, [hasBenefit, bodegaAddress, benefitBalanceWei, benefitAmountSoles]);

  async function handleRedeemBenefit() {
    if (!bodegaAddress || !beneficioTokenAddress || !smartAccountClient || !address) return;
    setIsRedeemSubmitting(true);
    setRedeemError(null);
    setIsRedeemConfirmed(false);
    try {
      const amountWei = parseEther((benefitAmountSoles || "0").trim() || "0");
      await sendAndWait(smartAccountClient, address, [
        {
          address: beneficioTokenAddress,
          abi: beneficioTokenAbi,
          functionName: "transfer",
          args: [bodegaAddress, amountWei],
        },
      ]);
      setIsRedeemConfirmed(true);
      setBenefitAmountSoles("");
      benefitBalanceQuery.refetch();
    } catch {
      setRedeemError("No se pudo pagar con tu beneficio. Revisa el monto e intenta de nuevo.");
    } finally {
      setIsRedeemSubmitting(false);
    }
  }

  async function handleRepay() {
    if (!bodegaAddress || !paymentRouterAddress || !smartAccountClient || !address) return;
    setIsRepaySubmitting(true);
    setRepayError(null);
    setIsRepayConfirmed(false);
    try {
      const ethAmount = solesToEth(Number(repayAmountSoles || "0"));
      await sendAndWait(smartAccountClient, address, [
        {
          address: paymentRouterAddress,
          abi: paymentRouterAbi,
          functionName: "payFiado",
          args: [bodegaAddress],
          value: parseEther(ethAmount.toFixed(18)),
        },
      ]);
      setIsRepayConfirmed(true);
      setRepayAmountSoles("");
      debtQuery.refetch();
    } catch {
      setRepayError("No se pudo completar el pago del fiado. Intenta de nuevo.");
    } finally {
      setIsRepaySubmitting(false);
    }
  }

  useEffect(() => {
    if (!address) return;
    fetch("/api/bodega/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json())
      .then((data) => setMyCode(data.code ?? null))
      .catch(() => setMyCode(null));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.funded) {
          setFaucetMessage(`🎁 Te regalamos ${formatSoles(Number(data.amountEth))} de saldo de prueba para que puedas probar la app.`);
        } else if (data.reason === "faucet_error") {
          console.error("[faucet] no se pudo fondear la cuenta", address);
        }
      })
      .catch((err) => console.error("[faucet] request failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function handlePay() {
    if (!bodegaAddress || !paymentRouterAddress || !smartAccountClient || !address) return;
    setIsPaySubmitting(true);
    setPayError(null);
    setIsPayConfirmed(false);
    try {
      const ethAmount = solesToEth(Number(amountSoles || "0"));
      await sendAndWait(smartAccountClient, address, [
        {
          address: paymentRouterAddress,
          abi: paymentRouterAbi,
          functionName: "receivePayment",
          args: [bodegaAddress],
          value: parseEther(ethAmount.toFixed(18)),
        },
      ]);

      setIsPayConfirmed(true);
      fiadoEnabledQuery.refetch();
      scoreQuery.refetch();
      limitQuery.refetch();
      aiInfoQuery.refetch();

      // Best-effort: avisar por Telegram si la bodega vinculó su cuenta. No bloquea
      // ni muestra error al comprador si falla — el pago ya está confirmado on-chain.
      fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodegaAddress,
          text: `💰 Te pagaron S/ ${Number(amountSoles || "0").toFixed(2)} en Bodegueando.`,
        }),
      }).catch(() => {});
    } catch {
      setPayError("No se pudo completar el pago. Intenta de nuevo.");
    } finally {
      setIsPaySubmitting(false);
    }
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
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
        La app todavía no está conectada a los contratos. Avísale a soporte.
      </p>
    );
  }

  const score = Number((scoreQuery.data as bigint | undefined) ?? BigInt(0));
  const limitEth = Number((limitQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18;
  const aiAdjusted = Boolean((aiInfoQuery.data as [boolean, bigint] | undefined)?.[0]);
  const confianza = confianzaLabel(score);

  const payDisabledReason = !isConnected
    ? isAccountLoading
      ? "Preparando tu cuenta…"
      : "Ingresa arriba para poder pagar."
    : null;

  return (
    <div className="flex w-full max-w-md flex-col gap-8 text-left">
      {faucetMessage && (
        <p className="rounded-xl border border-black/5 bg-[#c9e26514] px-4 py-3 text-sm text-[#0a0a0b]">
          {faucetMessage}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="bodega" className="text-sm font-medium text-[#0a0a0b]">
          Código de la bodega
        </label>
        <input
          id="bodega"
          inputMode="numeric"
          value={bodegaCodeInput}
          onChange={(e) => handleBodegaCodeChange(e.target.value)}
          placeholder="El código de 6 dígitos del cartel de la bodega"
          className={inputClass}
        />
        {isResolvingCode && <p className="text-xs text-[#6b6d64]">Buscando...</p>}
        {codeNotFound && <p className="text-xs text-red-500">No encontramos esa bodega, revisa el código.</p>}
        {codeIsNotABodega && (
          <p className="text-xs text-red-500">
            Ese código no corresponde a una bodega — revisa que sea el código que te mostró el
            cartel o QR de la tienda, no el tuyo.
          </p>
        )}
      </div>

      {bodegaAddress && isRealBodega && fiadoEnabled && (
        <div className={highlightBoxClass}>
          <div>
            <p className="text-xs text-[#6b6d64]">Fiado disponible en esta bodega</p>
            <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              {limitQuery.isLoading ? "…" : formatSoles(limitEth)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[#6b6d64]">Confianza:</span>
            <span className={`font-medium ${confianza.color}`}>
              {scoreQuery.isLoading ? "…" : confianza.text}
            </span>
            <span className="text-xs text-[#6b6d64]">
              ({scoreQuery.isLoading ? "…" : score}/1000{aiAdjusted ? ", ajustado por IA" : ""})
            </span>
          </div>

          {debtWei > BigInt(0) && (
            <div className="mt-1 flex flex-col gap-2 border-t border-black/10 pt-3">
              <p className="text-xs text-[#6b6d64]">
                Le debes a esta bodega: <span className="font-medium text-[#0a0a0b]">{formatSoles(Number(debtWei) / 1e18)}</span>
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={repayAmountSoles}
                  onChange={(e) => setRepayAmountSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <button onClick={handleRepay} disabled={!isConnected || isRepaySubmitting} className={outlineButtonClass}>
                {isRepaySubmitting ? "Pagando..." : "Pagar mi fiado"}
              </button>
              {repayError && <p className="text-xs text-red-500">{repayError}</p>}
              {isRepayConfirmed && <p className="text-xs text-green-600">¡Listo! Se descontó de tu deuda ✓</p>}
            </div>
          )}
        </div>
      )}
      {bodegaAddress && isRealBodega && !fiadoEnabled && !fiadoEnabledQuery.isLoading && (
        <p className="text-xs text-[#8f9189]">Esta bodega no ofrece fiado por ahora.</p>
      )}

      {isConnected && hasBenefit && (
        <div className={highlightBoxClass}>
          <div>
            <p className="text-xs text-[#6b6d64]">Tu beneficio social disponible</p>
            <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              S/ {(Number(benefitBalanceWei) / 1e18).toFixed(2)}
            </p>
            {benefitExpiresAt > 0 && (
              <p className="text-xs text-[#6b6d64]">
                Vence el {new Date(benefitExpiresAt * 1000).toLocaleDateString("es-PE")}
              </p>
            )}
          </div>
          <p className="text-xs text-[#6b6d64]">
            Solo se puede gastar en una bodega registrada — no se puede cambiar por efectivo ni
            mandarlo a otra persona.
          </p>
          {bodegaAddress && isRealBodega ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={benefitAmountSoles}
                  onChange={(e) => setBenefitAmountSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <button onClick={handleRedeemBenefit} disabled={isRedeemSubmitting} className={outlineButtonClass}>
                {isRedeemSubmitting ? "Pagando..." : "Pagar con tu beneficio social"}
              </button>
              {redeemError && <p className="text-xs text-red-500">{redeemError}</p>}
              {isRedeemConfirmed && <p className="text-xs text-green-600">¡Listo! Se pagó con tu beneficio ✓</p>}
            </>
          ) : (
            <p className="text-xs text-[#8f9189]">Escribe el código de la bodega arriba para pagar con esto.</p>
          )}
        </div>
      )}

      {bodegaAddress && isRealBodega && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Pagar en la bodega</h2>

          <div className="flex flex-col gap-1">
            <label htmlFor="amount" className="text-sm font-medium text-[#0a0a0b]">
              ¿Cuánto vas a pagar?
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">S/</span>
              <input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                value={amountSoles}
                onChange={(e) => setAmountSoles(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
          </div>

          <button
            onClick={handlePay}
            disabled={!isConnected || isPaySubmitting}
            className={primaryButtonClass}
            style={primaryButtonStyle}
          >
            {isPaySubmitting ? "Pagando..." : "Pagar"}
          </button>
          {payDisabledReason && <p className="text-xs text-[#6b6d64]">{payDisabledReason}</p>}
          {payError && <p className="text-xs text-red-500">{payError}</p>}
          {isPayConfirmed && <p className="text-xs text-green-600">¡Listo! Tu pago se registró ✓</p>}
        </section>
      )}
      {!isRealBodega && !bodegaAddress && (
        <p className="text-xs text-[#8f9189]">Escribe arriba el código de la bodega para poder pagar.</p>
      )}

      {isConnected && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Tu código para que te fíen</h2>
          <p className="text-xs text-[#6b6d64]">
            Muéstraselo a tu bodega si te va a fiar — así el fiado queda registrado a tu nombre.
          </p>
          {myCode ? (
            <p className="text-center text-2xl font-semibold tracking-widest text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              {myCode}
            </p>
          ) : (
            <p className="text-xs text-[#6b6d64]">Generando tu código…</p>
          )}
        </section>
      )}

      {isConnected && TELEGRAM_BOT_USERNAME && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Tus puntos por Telegram</h2>
          {telegramLinked ? (
            <p className="text-xs text-green-600">
              ✓ Vinculado — escríbele /perfil al bot cuando quieras ver tus puntos acumulados.
            </p>
          ) : (
            <>
              <p className="text-xs text-[#6b6d64]">
                Vincula tu cuenta con Telegram para consultar tus puntos escribiéndole /perfil al bot.
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
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${linkCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${primaryButtonClass} text-center`}
                    style={primaryButtonStyle}
                  >
                    2. Abrir el bot en Telegram y tocar Iniciar
                  </a>
                  <button onClick={handleCheckLinked} disabled={isLinkingTelegram} className={outlineButtonClass}>
                    {isLinkingTelegram ? "Revisando..." : "3. Ya lo hice, vincular"}
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
