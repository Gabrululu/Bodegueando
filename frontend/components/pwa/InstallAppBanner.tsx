"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";

/**
 * Invitación a instalar Bodegueando en la pantalla de inicio. Un bodeguero no va a buscar
 * "Instalar app" en el menú del navegador, así que se lo ofrecemos nosotros:
 * - Android / Chrome: el navegador dispara `beforeinstallprompt`; lo guardamos y el botón abre
 *   el diálogo nativo de instalación.
 * - iPhone (Safari) no tiene ese evento: se explica el paso a mano (Compartir → Agregar a inicio).
 * No se muestra si la app ya está instalada (se abrió en modo standalone) o si la persona la cerró.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallState = {
  promptEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  dismissed: boolean;
};

const DISMISSED_KEY = "bodegueando:install-dismissed";
const SERVER_STATE: InstallState = { promptEvent: null, installed: true, dismissed: true };

let state: InstallState = SERVER_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((notify) => notify());
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// El evento puede llegar antes de que el componente se monte, así que se escucha desde que se
// carga el módulo en el navegador.
if (typeof window !== "undefined") {
  state = {
    promptEvent: null,
    // iPhone no soporta display-mode en todas las versiones: también marca navigator.standalone.
    installed:
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    dismissed: readDismissed(),
  };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    setState({ promptEvent: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => setState({ installed: true, promptEvent: null }));
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return isIos && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

const subscribeNoop = () => () => {};

export function InstallAppBanner() {
  const { promptEvent, installed, dismissed } = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  const iosSafari = useSyncExternalStore(subscribeNoop, isIosSafari, () => false);

  if (installed || dismissed || (!promptEvent && !iosSafari)) return null;

  async function handleInstall() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // El evento sirve una sola vez; si la persona dijo que no, el navegador lo vuelve a ofrecer más adelante.
    setState({ promptEvent: null, installed: outcome === "accepted" });
  }

  function handleDismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Sin localStorage, se oculta solo por esta sesión.
    }
    setState({ dismissed: true });
  }

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left">
      <Image src="/icons/icon-192.png" alt="" width={40} height={40} className="shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#0a0a0b]">Ten Bodegueando en tu pantalla de inicio</p>
        <p className="text-xs text-[#55564f]">
          {promptEvent
            ? "Ábrela como una app, sin buscarla en el navegador."
            : "Toca el botón Compartir y luego “Agregar a inicio”."}
        </p>
      </div>
      {promptEvent && (
        <button
          onClick={handleInstall}
          className="shrink-0 cursor-pointer rounded-full px-4 py-2 text-sm font-semibold text-[#0a0a0b]"
          style={{ background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)" }}
        >
          Instalar
        </button>
      )}
      <button
        onClick={handleDismiss}
        aria-label="Cerrar"
        className="shrink-0 cursor-pointer rounded-full px-2 py-1 text-lg leading-none text-[#55564f] hover:bg-black/[0.04]"
      >
        ×
      </button>
    </div>
  );
}
