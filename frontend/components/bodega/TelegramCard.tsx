"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useTelegramLinked } from "@/lib/bodega/hooks";
import { cardClass, outlineButtonClass, primaryButtonClass, primaryButtonStyle, sectionTitleClass } from "@/lib/bodega/ui";

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

/** Vincular la bodega con el bot de Telegram (avisos de pago y /perfil). */
export function TelegramCard({ address }: { address: Address }) {
  const { linked, refresh } = useTelegramLinked(address);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!TELEGRAM_BOT_USERNAME) return null;

  async function handleGenerateCode() {
    setIsGeneratingCode(true);
    setMessage(null);
    try {
      const res = await fetch("/api/telegram/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      setLinkCode(data.code ?? null);
    } catch {
      setMessage("No pudimos generar el código. Intenta de nuevo.");
    } finally {
      setIsGeneratingCode(false);
    }
  }

  async function handleCheckLinked() {
    setIsChecking(true);
    setMessage(null);
    const isLinked = await refresh();
    setMessage(
      isLinked === null
        ? "No pudimos revisar. Intenta de nuevo."
        : isLinked
          ? "¡Listo! Vinculado."
          : "Todavía no te veo vinculado. Manda el mensaje al bot y vuelve a intentar.",
    );
    setIsChecking(false);
  }

  async function handleTestNotify() {
    setMessage(null);
    try {
      const res = await fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodegaAddress: address, kind: "test" }),
      });
      const data = await res.json();
      setMessage(
        data.sent
          ? "Mensaje de prueba enviado ✓"
          : data.reason === "already_sent"
            ? "Ya te mandamos uno hace poco. Revisa tu Telegram."
            : "No se pudo enviar. Revisa la vinculación.",
      );
    } catch {
      setMessage("No se pudo enviar. Intenta de nuevo.");
    }
  }

  return (
    <section id="telegram" className={cardClass}>
      <h2 className={sectionTitleClass}>Avisos por Telegram</h2>
      {linked ? (
        <>
          <p className="text-xs text-green-600">
            ✓ Vinculado — te avisamos cuando te paguen y puedes escribirle /perfil al bot para ver tus pagos y tu
            fiado cuando quieras.
          </p>
          <button onClick={handleTestNotify} className={outlineButtonClass}>
            Mandarme un mensaje de prueba
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-[#6b6d64]">
            Vincula tu bodega con Telegram para recibir avisos cuando te paguen y consultar tus pagos y tu fiado
            escribiéndole /perfil al bot, cuando quieras.
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
              <button onClick={handleCheckLinked} disabled={isChecking} className={outlineButtonClass}>
                {isChecking ? "Revisando..." : "3. Ya lo hice, vincular"}
              </button>
            </>
          )}
        </>
      )}
      {message && <p className="text-xs text-[#6b6d64]">{message}</p>}
    </section>
  );
}
