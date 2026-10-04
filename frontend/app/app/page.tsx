"use client";

import { useState, useSyncExternalStore } from "react";
import { useReadContract } from "wagmi";
import { Login } from "@/components/Login";
import { BuyerPanel } from "@/components/BuyerPanel";
import { BodegaOwnerPanel } from "@/components/BodegaOwnerPanel";
import { InstallAppBanner } from "@/components/pwa/InstallAppBanner";
import { paymentRouterAbi, paymentRouterAddress } from "@/lib/contracts";
import { sendAndWait, useSmartAccountClient } from "@/lib/smartAccount";

const primaryButtonClass =
  "cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const primaryButtonStyle = {
  background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)",
  boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
};
const outlineButtonClass =
  "cursor-pointer rounded-full border border-black/15 px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition-colors hover:bg-black/[0.04]";

function roleStorageKey(address: string) {
  return `bodegueando:role:${address.toLowerCase()}`;
}

/**
 * La elección "Soy cliente" vive en localStorage (por dirección) y se lee con
 * useSyncExternalStore, sin copiarla a un estado con un efecto. Si el navegador no deja usar
 * localStorage (modo privado, almacenamiento bloqueado), queda en memoria para esta sesión.
 */
const roleListeners = new Set<() => void>();
const memoryRoles = new Set<string>();

function subscribeRole(onChange: () => void) {
  roleListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    roleListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStoredRole(address: string | null): "cliente" | null {
  if (!address) return null;
  const key = roleStorageKey(address);
  try {
    if (window.localStorage.getItem(key) === "cliente") return "cliente";
  } catch {
    // Sin acceso a localStorage: solo cuenta lo que se eligió en esta sesión.
  }
  return memoryRoles.has(key) ? "cliente" : null;
}

function storeClienteRole(address: string) {
  const key = roleStorageKey(address);
  memoryRoles.add(key);
  try {
    window.localStorage.setItem(key, "cliente");
  } catch {
    // Queda solo en memoria.
  }
  roleListeners.forEach((notify) => notify());
}

/**
 * Bodeguero y cliente son dos espacios separados, nunca combinados en la misma pantalla:
 * una cuenta ya registrada como bodega (`isBodega` on-chain) va directo a su panel, sin
 * opción de ver la vista de cliente. Una cuenta nueva elige explícitamente una vez
 * ("Soy bodeguero" / "Soy cliente") — la elección de cliente se recuerda por dirección
 * (localStorage) para no volver a preguntar en cada visita, pero nunca se infiere sola.
 */
export default function AppHome() {
  const { client: smartAccountClient, address, isLoading: isAccountLoading } = useSmartAccountClient();
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const isBodegaQuery = useReadContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && paymentRouterAddress) },
  });

  const isBodega = isBodegaQuery.data === true;
  const chosenRole = useSyncExternalStore(
    subscribeRole,
    () => readStoredRole(address),
    () => null,
  );

  async function handleRegisterBodega() {
    if (!smartAccountClient || !address || !paymentRouterAddress) return;
    setIsRegistering(true);
    setRegisterError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: paymentRouterAddress, abi: paymentRouterAbi, functionName: "registerSelf", args: [] },
      ]);
      isBodegaQuery.refetch();
    } catch (err) {
      // El detalle real (bundler, paymaster, Privy) queda en la consola para poder diagnosticarlo.
      console.error("[registro de bodega] falló", err);
      // Si la cuenta igual quedó registrada (p. ej. el recibo tardó), entra directo al panel.
      const { data: registered } = await isBodegaQuery.refetch();
      if (!registered) setRegisterError("No pudimos registrar tu bodega ahora mismo. Recarga la página e intenta de nuevo.");
    } finally {
      setIsRegistering(false);
    }
  }

  function chooseCliente() {
    if (!address) return;
    storeClienteRole(address);
  }

  const isReady = Boolean(address) && isAccountLoading === false && !isBodegaQuery.isLoading;
  const showRolePicker = isReady && !isBodega && chosenRole === null;
  const showBodegaPanel = isReady && isBodega;
  const showBuyerPanel = isReady && !isBodega && chosenRole === "cliente";

  return (
    <div className="flex flex-col flex-1 items-center bg-[#fafaf7] [font-family:var(--font-geist-sans)]">
      <main
        className={`flex w-full flex-col items-center gap-8 px-4 text-center sm:px-6 ${
          showBodegaPanel ? "max-w-5xl py-6" : "max-w-xl py-6"
        }`}
      >
        {/* Barra superior: marca a la izquierda, cuenta (correo + Salir) a la derecha. */}
        <header className="flex w-full items-center justify-between gap-3 border-b border-black/10 pb-4">
          <div className="flex items-center gap-2">
            <img src="/logo-mark.svg" alt="" className="h-8 w-8 shrink-0" />
            <span className="text-lg font-semibold tracking-tight text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Bodegueando
            </span>
          </div>
          {address && <Login />}
        </header>

        {address && <InstallAppBanner />}

        {!address && (
          <div className="space-y-4">
            <p className="text-[#55564f]">Paga rápido, junta puntos y accede a fiado en tu bodega de barrio.</p>
            <Login />
          </div>
        )}

        {showRolePicker && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-[#55564f]">¿Cómo vas a usar Bodegueando?</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleRegisterBodega}
                disabled={isRegistering}
                className={primaryButtonClass}
                style={primaryButtonStyle}
              >
                {isRegistering ? "Registrando tu bodega..." : "Soy bodeguero"}
              </button>
              <button onClick={chooseCliente} className={outlineButtonClass}>
                Soy cliente
              </button>
            </div>
            {registerError && <p className="text-xs text-red-500">{registerError}</p>}
          </div>
        )}

        {showBodegaPanel && <BodegaOwnerPanel />}
        {showBuyerPanel && <BuyerPanel />}
      </main>
    </div>
  );
}
