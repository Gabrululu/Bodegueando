"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { Login } from "@/components/Login";
import { BuyerPanel } from "@/components/BuyerPanel";
import { BodegaOwnerPanel } from "@/components/BodegaOwnerPanel";
import { paymentRouterAbi, paymentRouterAddress } from "@/lib/contracts";
import { sendAndWait, useSmartAccountClient } from "@/lib/smartAccount";

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

        {address && isAccountLoading === false && (isBodega ? <BodegaOwnerPanel /> : <BuyerPanel />)}

        {address && !isBodega && !isBodegaQuery.isLoading && (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleRegisterBodega}
              disabled={isRegistering}
              className="cursor-pointer text-xs text-[#6b6d64] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRegistering ? "Registrando tu bodega..." : "¿Tienes una bodega? Regístrala aquí"}
            </button>
            {registerError && <p className="text-xs text-red-500">{registerError}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
