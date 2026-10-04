"use client";

import { useEffect } from "react";

/**
 * Registra public/sw.js (página sin conexión, ver ese archivo). Solo en producción: en
 * desarrollo un service worker puede servir respuestas viejas mientras se edita el código.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.error("[pwa] no se pudo registrar el service worker", err));
  }, []);
  return null;
}
