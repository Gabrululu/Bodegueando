"use client";

import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { STABLECOIN_DECIMALS } from "@/lib/contracts";

const REFRESH_MS = 5 * 60 * 1000;
const FALLBACK_USD_PEN = 3.39;

/**
 * Tasa USD -> PEN para que la UI siempre muestre soles: todo el dinero de la app está en USDG
 * (1 USDG = 1 USD) y PUNTOS/fiado en USD. Mientras carga la primera vez usa el mismo respaldo
 * que el servidor, así el monto en soles se ve razonable desde el primer render en vez de
 * mostrar "...".
 */
export function useExchangeRate() {
  const [usdPen, setUsdPen] = useState(FALLBACK_USD_PEN);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/exchange-rate");
        if (!res.ok) return;
        const data = (await res.json()) as { usdPen: number };
        if (!cancelled && data.usdPen) {
          setUsdPen(data.usdPen);
        }
      } catch {
        // se queda con la última tasa conocida (o el respaldo)
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function formatSolesFromUsd(usdAmount: number): string {
    return `S/ ${(usdAmount * usdPen).toFixed(2)}`;
  }

  function solesToUsd(soles: number): number {
    return soles / usdPen;
  }

  /**
   * Monto en USDG (unidades del token, 6 decimales) mostrado en soles. Con `withUsd`, agrega el
   * equivalente en dólares — útil donde el usuario maneja saldo o préstamos y conviene que sepa
   * que el valor real está en dólares; en el resto de la app basta con soles.
   */
  function formatStablecoin(units: bigint, { withUsd = false }: { withUsd?: boolean } = {}): string {
    const usd = Number(units) / 10 ** STABLECOIN_DECIMALS;
    const soles = formatSolesFromUsd(usd);
    return withUsd ? `${soles} (≈ US$ ${usd.toFixed(2)})` : soles;
  }

  /** Lo que el usuario escribió en soles, convertido a unidades de USDG para firmar. */
  function solesToStablecoin(soles: string | number): bigint {
    const usd = solesToUsd(Number(soles || 0));
    if (!Number.isFinite(usd) || usd <= 0) return BigInt(0);
    return parseUnits(usd.toFixed(STABLECOIN_DECIMALS), STABLECOIN_DECIMALS);
  }

  return {
    usdPen,
    isLoading,
    formatSolesFromUsd,
    solesToUsd,
    formatStablecoin,
    solesToStablecoin,
  };
}
