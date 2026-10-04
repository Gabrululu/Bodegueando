"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useBodegaCode } from "@/lib/bodega/hooks";
import { dailyTotals, useSalesHistory } from "@/lib/bodega/activity";
import {
  cardClass,
  formatPaymentDate,
  highlightBoxClass,
  mutedTextClass,
  outlineButtonClass,
  sectionTitleClass,
} from "@/lib/bodega/ui";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { SalesChart } from "./SalesChart";
import { TelegramCard } from "./TelegramCard";
import type { TabProps } from "./types";

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
] as const;
const PAGE_SIZE = 20;

/** Cobrar: el QR para el mostrador, el historial completo de ventas y los avisos por Telegram. */
export function CobrarTab({ address }: TabProps) {
  const bodegaCode = useBodegaCode(address);
  const sales = useSalesHistory(address);
  const { formatSolesFromUsd, usdPen } = useExchangeRate();
  const [copied, setCopied] = useState(false);
  const [rangeDays, setRangeDays] = useState<number>(7);
  const [visible, setVisible] = useState(PAGE_SIZE);

  async function handleCopy() {
    if (!bodegaCode) return;
    await navigator.clipboard.writeText(bodegaCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const allSales = sales.data ?? [];
  const buckets = dailyTotals(allSales, rangeDays);
  const rangeTotalUsd = buckets.reduce((sum, b) => sum + b.totalUsd, 0);
  const rangeCount = buckets.reduce((sum, b) => sum + b.count, 0);
  const rangeCustomers = new Set(
    allSales
      .filter((s) => s.timestamp * 1000 >= buckets[0].day.getTime())
      .map((s) => s.payer.toLowerCase()),
  ).size;

  return (
    <div className="flex flex-col gap-6">
      <section id="qr" className={cardClass}>
        <h2 className={sectionTitleClass}>Tu código para cobrar</h2>
        <p className={mutedTextClass}>Que tus clientes escaneen este código para pagarte.</p>
        {bodegaCode ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl border border-black/10 bg-white p-3">
              <QRCodeSVG value={`${typeof window !== "undefined" ? window.location.origin : ""}/pagar/${bodegaCode}`} size={180} />
            </div>
            <p className={mutedTextClass}>O si no se puede escanear, este código:</p>
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
          <p className={mutedTextClass}>Generando tu código…</p>
        )}
      </section>

      <section id="ventas" className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionTitleClass}>Tus ventas</h2>
          <div className="inline-flex rounded-full border border-black/10 p-0.5" role="group" aria-label="Periodo">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setRangeDays(r.days)}
                aria-pressed={rangeDays === r.days}
                className={`min-h-8 cursor-pointer rounded-full px-3 text-xs font-semibold ${
                  rangeDays === r.days ? "bg-[#c9e265] text-[#0a0a0b]" : "text-[#6b6d64]"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {sales.isLoading ? (
          <p className={mutedTextClass}>Cargando tu historial…</p>
        ) : sales.isError ? (
          <p className="text-xs text-red-500">No pudimos leer tu historial ahora mismo. Intenta en un momento.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className={highlightBoxClass}>
                <p className={mutedTextClass}>Vendiste</p>
                <p className="text-lg font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                  {formatSolesFromUsd(rangeTotalUsd)}
                </p>
              </div>
              <div className={highlightBoxClass}>
                <p className={mutedTextClass}>Ventas</p>
                <p className="text-lg font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">{rangeCount}</p>
              </div>
              <div className={highlightBoxClass}>
                <p className={mutedTextClass}>Clientes</p>
                <p className="text-lg font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">{rangeCustomers}</p>
              </div>
            </div>

            <p className="text-xs font-medium text-[#0a0a0b]">Ventas por día, en soles</p>
            <SalesChart buckets={buckets} toSoles={(usd) => usd * usdPen} formatSoles={formatSolesFromUsd} />

            {allSales.length === 0 ? (
              <p className={mutedTextClass}>Todavía no tienes ventas registradas. Muestra tu QR para empezar a cobrar.</p>
            ) : (
              <>
                <p className="text-xs font-medium text-[#0a0a0b]">Todas tus ventas</p>
                <ul className="flex flex-col divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/10">
                  {allSales.slice(0, visible).map((s) => (
                    <li key={s.txHash + s.timestamp} className="flex items-center justify-between gap-3 bg-white px-3 py-2 text-sm">
                      <span className="text-[#6b6d64]">{formatPaymentDate(s.timestamp)}</span>
                      <span className="font-medium tabular-nums text-[#0a0a0b]">{formatSolesFromUsd(s.amountUsd)}</span>
                    </li>
                  ))}
                </ul>
                {allSales.length > visible && (
                  <button onClick={() => setVisible((v) => v + PAGE_SIZE)} className={outlineButtonClass}>
                    Ver más ({allSales.length - visible} restantes)
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>

      <TelegramCard address={address} />
    </div>
  );
}

