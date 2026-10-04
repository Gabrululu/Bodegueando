/**
 * Clases compartidas por todas las pestañas del panel de bodega (antes vivían al inicio de
 * BodegaOwnerPanel.tsx). Mismo lenguaje visual de siempre: tarjetas redondeadas, verde lima.
 */
export const cardClass = "flex flex-col gap-3 rounded-[20px] border border-black/10 bg-[#fffffc] p-5 shadow-sm";
export const sectionTitleClass =
  "text-sm font-semibold uppercase tracking-wide text-[#6b6d64] [font-family:var(--font-bricolage)]";
export const inputClass =
  "rounded-xl border border-black/15 bg-white px-3 py-2 text-center text-lg font-semibold tracking-widest text-[#0a0a0b] outline-none focus:border-black/35";
export const numberInputClass =
  "w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-base text-[#0a0a0b] outline-none focus:border-black/35";
export const textInputClass =
  "rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35";
export const primaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
export const primaryButtonStyle = {
  background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)",
  boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
};
export const outlineButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50";
export const highlightBoxClass = "rounded-xl border border-black/5 bg-[#c9e26514] p-4";
export const statValueClass = "text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]";
export const mutedTextClass = "text-xs text-[#6b6d64]";

export function formatPaymentDate(unixSeconds: number): string {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleString("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
}

/** "en 3 días", "mañana", "hace 2 días" — para pendientes y vencimientos. */
export function relativeDays(unixSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const days = Math.round((unixSeconds - nowSeconds) / 86400);
  if (days === 0) return unixSeconds >= nowSeconds ? "hoy" : "hoy (ya pasó)";
  if (days === 1) return "mañana";
  if (days === -1) return "ayer";
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}
