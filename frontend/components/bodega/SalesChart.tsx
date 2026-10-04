"use client";

import { formatDay } from "@/lib/bodega/ui";

type Bucket = { day: Date; totalUsd: number; count: number };

/**
 * Redondea el máximo del eje a un número "limpio" cuya mitad también lo sea (la guía del medio):
 * 104 → 120 (60), 47 → 50 (25), 9 → 10 (5).
 */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Ventas por día en columnas, una sola serie (sin leyenda: el título ya dice qué es).
 * Montos en soles; el eje usa números redondos, cada columna muestra su valor al pasar el
 * cursor o enfocarla, y la misma información está en una tabla para quien no ve el gráfico.
 */
export function SalesChart({
  buckets,
  toSoles,
  formatSoles,
}: {
  buckets: Bucket[];
  toSoles: (usd: number) => number;
  formatSoles: (usd: number) => string;
}) {
  const maxSoles = niceMax(Math.max(...buckets.map((b) => toSoles(b.totalUsd))));
  const ticks = [maxSoles, maxSoles / 2, 0];
  const labelEvery = buckets.length > 14 ? 5 : buckets.length > 7 ? 2 : 1;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="flex h-36 flex-col justify-between py-0 text-right text-[10px] tabular-nums text-[#8a8c81]">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {t.toLocaleString("es-PE")}
            </span>
          ))}
        </div>
        <div className="relative h-36 flex-1">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-black/[0.08]"
              style={{ top: `${(1 - t / maxSoles) * 100}%` }}
              aria-hidden
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {buckets.map((b, i) => {
              // El tooltip se alinea hacia adentro en los extremos para no salirse de la tarjeta.
              const third = i / Math.max(1, buckets.length - 1);
              const tooltipAlign = third < 0.34 ? "left-0" : third > 0.66 ? "right-0" : "left-1/2 -translate-x-1/2";
              const soles = toSoles(b.totalUsd);
              const heightPct = (soles / maxSoles) * 100;
              const label = `${formatDay(b.day.getTime() / 1000)}: ${formatSoles(b.totalUsd)} en ${b.count} venta${b.count === 1 ? "" : "s"}`;
              return (
                <div
                  key={b.day.getTime()}
                  tabIndex={0}
                  aria-label={label}
                  className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                >
                  <div
                    className="w-full max-w-6 rounded-t-[4px] bg-[#718817] transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                    style={{ height: soles > 0 ? `max(${heightPct}%, 3px)` : 0 }}
                  />
                  <div
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full ${tooltipAlign} z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-[#0a0a0b] px-2 py-1 text-[11px] text-white shadow group-hover:block group-focus-visible:block`}
                  >
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-[2px] pl-8 text-[10px] text-[#8a8c81]">
        {buckets.map((b, i) => (
          <span key={b.day.getTime()} className="flex-1 text-center">
            {i % labelEvery === 0 || i === buckets.length - 1 ? b.day.getDate() : ""}
          </span>
        ))}
      </div>
      <details className="text-xs text-[#6b6d64]">
        <summary className="cursor-pointer">Ver como tabla</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="text-[#8a8c81]">
              <th className="py-1 font-medium">Día</th>
              <th className="py-1 font-medium">Ventas</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {[...buckets].reverse().map((b) => (
              <tr key={b.day.getTime()} className="border-t border-black/[0.06]">
                <td className="py-1">{formatDay(b.day.getTime() / 1000)}</td>
                <td className="py-1">{b.count}</td>
                <td className="py-1 text-right text-[#0a0a0b]">{formatSoles(b.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
