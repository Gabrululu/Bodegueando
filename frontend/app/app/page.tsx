"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { Login } from "@/components/Login";
import { BuyerPanel } from "@/components/BuyerPanel";
import { BodegaOwnerPanel } from "@/components/BodegaOwnerPanel";
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
  const [chosenRole, setChosenRole] = useState<"cliente" | null>(null);

  const isBodegaQuery = useReadContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && paymentRouterAddress) },
  });

  const isBodega = isBodegaQuery.data === true;

  useEffect(() => {
    if (!address) {
      setChosenRole(null);
      return;
    }
    const stored = window.localStorage.getItem(roleStorageKey(address));
    setChosenRole(stored === "cliente" ? "cliente" : null);
  }, [address]);

  async function handleRegisterBodega() {
    if (!smartAccountClient || !address || !paymentRouterAddress) return;
    setIsRegistering(true);
    setRegisterError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: paymentRouterAddress, abi: paymentRouterAbi, functionName: "registerSelf", args: [] },
      ]);
      isBodegaQuery.refetch();
    } catch {
      setRegisterError("No pudimos registrar tu bodega ahora mismo. Intenta de nuevo.");
    } finally {
      setIsRegistering(false);
    }
  }

  function chooseCliente() {
    if (!address) return;
    window.localStorage.setItem(roleStorageKey(address), "cliente");
    setChosenRole("cliente");
  }

  const isReady = Boolean(address) && isAccountLoading === false && !isBodegaQuery.isLoading;
  const showRolePicker = isReady && !isBodega && chosenRole === null;
  const showBodegaPanel = isReady && isBodega;
  const showBuyerPanel = isReady && !isBodega && chosenRole === "cliente";

  return (
    <div className="flex flex-col flex-1 items-center bg-[#fafaf7] [font-family:var(--font-geist-sans)]">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2.5">
            <img src="/logo-mark.svg" alt="" className="h-9 w-9 shrink-0" />
            <h1 className="text-3xl font-semibold tracking-tight text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Bodegueando
            </h1>
          </div>
          <p className="text-[#55564f]">
            Paga rápido, junta puntos y accede a fiado en tu bodega de barrio.
          </p>
        </div>

        <Login />

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
