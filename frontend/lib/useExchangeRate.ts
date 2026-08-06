"use client";

import { useEffect, useState } from "react";

const REFRESH_MS = 5 * 60 * 1000;
const FALLBACK_ETH_PEN = 6500;

/**
 * Tasa ETH -> PEN para que la UI nunca muestre montos en ETH. Mientras carga la
 * primera vez usa el mismo respaldo que el servidor, así el monto en soles se ve
 * razonable desde el primer render en vez de mostrar "..." o "ETH".
 */
export function useExchangeRate() {
  const [ethPen, setEthPen] = useState(FALLBACK_ETH_PEN);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/exchange-rate");
        if (!res.ok) return;
        const data = (await res.json()) as { ethPen: number };
        if (!cancelled && data.ethPen) {
          setEthPen(data.ethPen);
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

  function formatSoles(ethAmount: number): string {
    return `S/ ${(ethAmount * ethPen).toFixed(2)}`;
  }

  function solesToEth(soles: number): number {
    return soles / ethPen;
  }

  return { ethPen, isLoading, formatSoles, solesToEth };
}
