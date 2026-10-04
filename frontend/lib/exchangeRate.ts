// Server-only: tasa de cambio USD -> PEN para mostrar montos en soles. Todo lo que mueve dinero
// en la app está en USDG (1 USDG = 1 USD) y PUNTOS/fiado están en USD, así que esta es la única
// tasa que hace falta. No hay contrato de por medio: es de display, y para convertir lo que el
// usuario escribe en soles al monto en USDG que firma.
//
// Fuente sin API key: open.er-api.com (frankfurter.app se descartó porque solo cubre monedas
// ECB, no incluye soles peruanos). Cacheado en memoria ~5 minutos para no golpear la API en
// cada request, y con una tasa de respaldo hardcodeada por si está caída — la demo no se puede
// romper por una API externa.
const CACHE_TTL_MS = 5 * 60 * 1000;
export const FALLBACK_USD_PEN = 3.39; // aprox. ago 2026, ajustar si se aleja mucho de la realidad

type Rates = { usdPen: number; updatedAt: number; isFallback: boolean };

let cache: Rates | null = null;

async function fetchUsdPen(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`open.er-api.com respondió ${res.status}`);
  const data = (await res.json()) as { rates?: { PEN?: number } };
  const pen = data.rates?.PEN;
  if (!pen) throw new Error("open.er-api.com no devolvió una tasa válida");
  return pen;
}

export async function getExchangeRates(): Promise<Rates> {
  if (cache && Date.now() - cache.updatedAt < CACHE_TTL_MS) {
    return cache;
  }

  try {
    cache = { usdPen: await fetchUsdPen(), updatedAt: Date.now(), isFallback: false };
  } catch {
    cache = { usdPen: FALLBACK_USD_PEN, updatedAt: Date.now(), isFallback: true };
  }

  return cache;
}
