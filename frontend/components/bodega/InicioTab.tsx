"use client";

import { confianzaLabel } from "@/lib/fiado";
import { dailyTotals, useSalesHistory } from "@/lib/bodega/activity";
import {
  INVOICE_STATUS,
  useBodegaCode,
  useBodegaCore,
  useBodegaLocations,
  useGroupOrders,
  useMyInvoices,
  useMyLoans,
  useNowSeconds,
  useTelegramLinked,
} from "@/lib/bodega/hooks";
import { cardClass, highlightBoxClass, mutedTextClass, relativeDays, sectionTitleClass } from "@/lib/bodega/ui";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { SalesChart } from "./SalesChart";
import type { BodegaTab, TabProps } from "./types";

type Pending = { key: string; icon: string; text: string; tab: BodegaTab; anchor: string; urgent: boolean };

const SOON_SECONDS = 3 * 86400;

/**
 * Inicio: cómo va el negocio de un vistazo y qué requiere atención. No tiene acciones propias —
 * cada pendiente lleva a la pestaña donde se resuelve.
 */
export function InicioTab({ address, navigate }: TabProps) {
  const core = useBodegaCore(address);
  const sales = useSalesHistory(address);
  const { invoices } = useMyInvoices(address);
  const { loans } = useMyLoans(address);
  const locations = useBodegaLocations(address);
  const { orders } = useGroupOrders(address, locations.savedLocation, locations.locationsByAddress);
  const telegram = useTelegramLinked(address);
  const bodegaCode = useBodegaCode(address);
  const { formatSolesFromUsd, formatStablecoin, usdPen } = useExchangeRate();
  const confianza = confianzaLabel(core.score);

  const now = useNowSeconds();
  const week = dailyTotals(sales.data ?? [], 7);
  const today = week[week.length - 1];
  const weekTotalUsd = week.reduce((sum, b) => sum + b.totalUsd, 0);
  const weekCount = week.reduce((sum, b) => sum + b.count, 0);

  const pending: Pending[] = [];
  for (const inv of invoices) {
    if (inv.status !== INVOICE_STATUS.Active) continue;
    const shortfall = inv.principal - inv.repaidAmount;
    if (inv.dueDate < now && shortfall > BigInt(0)) {
      pending.push({ key: `inv-${inv.id}`, icon: "⚠", text: `Fiado con garantía de ${formatStablecoin(inv.principal)} venció sin pagarse — reclama la garantía`, tab: "fiado", anchor: "facturas", urgent: true });
    } else if (inv.dueDate - now <= SOON_SECONDS) {
      pending.push({ key: `inv-${inv.id}`, icon: "📒", text: `Fiado con garantía de ${formatStablecoin(inv.principal)} vence ${relativeDays(inv.dueDate, now)}`, tab: "fiado", anchor: "facturas", urgent: false });
    }
  }
  for (const loan of loans) {
    if (loan.dueDate < now) {
      pending.push({ key: `loan-${loan.id}`, icon: "⚠", text: `Tu préstamo venció — paga ${formatStablecoin(loan.owed)} para recuperar tu garantía`, tab: "credito", anchor: "prestamo", urgent: true });
    } else if (loan.dueDate - now <= 7 * 86400) {
      pending.push({ key: `loan-${loan.id}`, icon: "🏦", text: `Tu préstamo vence ${relativeDays(loan.dueDate, now)}: ${formatStablecoin(loan.owed)}`, tab: "credito", anchor: "prestamo", urgent: false });
    }
  }
  for (const o of orders) {
    if (o.withdrawn) continue;
    const closed = now > o.pledgeDeadline;
    const reached = o.pledged >= o.goal;
    const windowOpen = now <= o.pledgeDeadline + o.withdrawWindowSeconds;
    if (o.isMine && closed && reached && windowOpen) {
      pending.push({ key: `go-${o.id}`, icon: "🤝", text: `"${o.title}" llegó a la meta — retira el fondo para comprar`, tab: "red", anchor: "pedidos", urgent: true });
    } else if (o.isMine && !closed && o.pledgeDeadline - now <= 2 * 86400) {
      const pct = o.goal > BigInt(0) ? Number((o.pledged * BigInt(100)) / o.goal) : 0;
      pending.push({ key: `go-${o.id}`, icon: "🤝", text: `Tu pedido "${o.title}" cierra ${relativeDays(o.pledgeDeadline, now)} (${pct}% juntado)`, tab: "red", anchor: "pedidos", urgent: false });
    } else if (o.myPledge > BigInt(0) && closed && (!reached || !windowOpen)) {
      pending.push({ key: `go-${o.id}`, icon: "↩", text: `Puedes recuperar tu aporte de ${formatStablecoin(o.myPledge)} en "${o.title}"`, tab: "red", anchor: "pedidos", urgent: false });
    }
  }
  pending.sort((a, b) => Number(b.urgent) - Number(a.urgent));

  const steps = [
    { done: Boolean(bodegaCode), text: "Registrar tu bodega", tab: "cobrar" as const, anchor: "qr" },
    { done: (sales.data?.length ?? 0) > 0, text: "Mostrar tu QR y cobrar tu primera venta", tab: "cobrar" as const, anchor: "qr" },
    { done: locations.savedLocation !== null, text: "Guardar tu ubicación en el mapa", tab: "red" as const, anchor: "ubicacion" },
    { done: telegram.linked === true, text: "Vincular Telegram para recibir avisos", tab: "cobrar" as const, anchor: "telegram" },
    { done: core.fiadoEnabled, text: "Activar el fiado para tus clientes", tab: "fiado" as const, anchor: "fiado" },
  ];
  const stepsLoaded = locations.isLoaded && telegram.linked !== null && !sales.isLoading && !core.fiadoEnabledLoading;
  const doneCount = steps.filter((s) => s.done).length;

  const kpiValue = (value: string) => (sales.isLoading ? "…" : value);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Resumen">
        <div className={cardClass}>
          <p className={mutedTextClass}>Hoy</p>
          <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">{kpiValue(formatSolesFromUsd(today.totalUsd))}</p>
          <p className={mutedTextClass}>{kpiValue(`${today.count} venta${today.count === 1 ? "" : "s"}`)}</p>
        </div>
        <div className={cardClass}>
          <p className={mutedTextClass}>Últimos 7 días</p>
          <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">{kpiValue(formatSolesFromUsd(weekTotalUsd))}</p>
          <p className={mutedTextClass}>{kpiValue(`${weekCount} venta${weekCount === 1 ? "" : "s"}`)}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("fiado", "deudores")}
          className={`${cardClass} col-span-2 cursor-pointer text-left transition-colors hover:border-black/20 sm:col-span-1`}
        >
          <p className={mutedTextClass}>Por cobrar de fiado</p>
          <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
            {core.outstandingLoading ? "…" : formatSolesFromUsd(core.outstandingUsd)}
          </p>
          <p className="text-xs font-medium text-[#55564f]">Ver quién te debe →</p>
        </button>
      </section>

      <section className={cardClass}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={sectionTitleClass}>Ventas de la semana</h2>
          <button type="button" onClick={() => navigate("cobrar", "ventas")} className="cursor-pointer text-xs font-medium text-[#55564f] underline underline-offset-2">
            Ver todo →
          </button>
        </div>
        {sales.isLoading ? (
          <p className={mutedTextClass}>Cargando…</p>
        ) : sales.isError ? (
          <p className="text-xs text-red-500">No pudimos leer tus ventas ahora mismo.</p>
        ) : (
          <SalesChart buckets={week} toSoles={(usd) => usd * usdPen} formatSoles={formatSolesFromUsd} />
        )}
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Pendientes{pending.length > 0 ? ` (${pending.length})` : ""}</h2>
        {pending.length === 0 ? (
          <p className={mutedTextClass}>Todo al día. ✓</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => navigate(p.tab, p.anchor)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors hover:bg-black/[0.02] ${
                    p.urgent ? "border-amber-400/50 bg-amber-50" : "border-black/10"
                  }`}
                >
                  <span aria-hidden>{p.icon}</span>
                  <span className="flex-1 text-[#0a0a0b]">{p.text}</span>
                  <span aria-hidden className="text-[#8a8c81]">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" onClick={() => navigate("credito", "score")} className={`${cardClass} cursor-pointer text-left transition-colors hover:border-black/20`}>
        <h2 className={sectionTitleClass}>Tu nivel de confianza</h2>
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-xl font-semibold ${confianza.color}`}>{core.scoreLoading ? "…" : confianza.text}</p>
          <p className="text-sm tabular-nums text-[#6b6d64]">{core.scoreLoading ? "…" : core.score} / 1000</p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#c9e26540]" aria-hidden>
          <div className="h-full rounded-full bg-[#718817]" style={{ width: `${Math.min(100, core.score / 10)}%` }} />
        </div>
        <p className={mutedTextClass}>Puedes fiar hasta {core.limitLoading ? "…" : formatSolesFromUsd(core.limitUsd)} · ¿cómo subirlo? →</p>
      </button>

      {stepsLoaded && doneCount < steps.length && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>
            Empieza aquí ({doneCount}/{steps.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {steps.map((s) => (
              <li key={s.text}>
                {s.done ? (
                  <p className="flex items-center gap-2 py-1 text-sm text-[#8a8c81] line-through">
                    <span aria-hidden className="no-underline">✓</span> {s.text}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(s.tab, s.anchor)}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-lg py-1 text-left text-sm font-medium text-[#0a0a0b] ${highlightBoxClass.replace("p-4", "px-3")}`}
                  >
                    <span aria-hidden>○</span> <span className="flex-1">{s.text}</span> <span aria-hidden>→</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
