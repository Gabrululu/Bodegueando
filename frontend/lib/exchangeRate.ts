// Server-only: tasa de cambio ETH -> PEN para mostrar montos en soles en vez de
// ETH. No hay contrato de por medio, es puramente de display.
//
// Fuentes sin API key: CoinGecko (ETH/USD) y open.er-api.com (USD/PEN — frankfurter.app
// se descartó porque solo cubre monedas ECB, no incluye soles peruanos).
// Cacheado en memoria ~5 minutos para no golpear las APIs en cada request, y con
// una tasa de respaldo hardcodeada por si alguna de las dos está caída — la demo
// no se puede romper por una API externa.
const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_ETH_PEN = 6500; // aprox. ETH ~$1920 * PEN 3.39 (ago 2026), ajustar si se aleja mucho de la realidad

let cache: { ethPen: number; updatedAt: number; isFallback: boolean } | null = null;

async function fetchEthUsd(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) throw new Error(`CoinGecko respondió ${res.status}`);
  const data = (await res.json()) as { ethereum?: { usd?: number } };
  const usd = data.ethereum?.usd;
  if (!usd) throw new Error("CoinGecko no devolvió un precio válido");
  return usd;
}

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

export async function getEthPenRate(): Promise<{
  ethPen: number;
  updatedAt: number;
  isFallback: boolean;
}> {
  if (cache && Date.now() - cache.updatedAt < CACHE_TTL_MS) {
    return cache;
  }

  try {
    const [ethUsd, usdPen] = await Promise.all([fetchEthUsd(), fetchUsdPen()]);
    cache = { ethPen: ethUsd * usdPen, updatedAt: Date.now(), isFallback: false };
  } catch {
    cache = { ethPen: FALLBACK_ETH_PEN, updatedAt: Date.now(), isFallback: true };
  }

  return cache;
}
