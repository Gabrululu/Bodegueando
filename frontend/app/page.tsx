"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { PasskeyLogin } from "@/components/PasskeyLogin";
import { BuyerPanel } from "@/components/BuyerPanel";
import { BodegaOwnerPanel } from "@/components/BodegaOwnerPanel";
import { paymentRouterAbi, paymentRouterAddress } from "@/lib/contracts";

type View = "auto" | "bodega" | "comprador";

export default function Home() {
  const { address, isConnected } = useAccount();
  const [view, setView] = useState<View>("auto");

  const isBodegaQuery = useReadContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && paymentRouterAddress) },
  });

  const detectedBodega = isConnected && isBodegaQuery.data === true;
  const effectiveView: "bodega" | "comprador" = view === "auto" ? (detectedBodega ? "bodega" : "comprador") : view;

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Bodegueando
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Paga rápido, junta puntos y accede a fiado en tu bodega de barrio.
          </p>
        </div>

        <PasskeyLogin />

        {isConnected && (
          <div className="flex gap-4 text-xs">
            <button
              onClick={() => setView("comprador")}
              className={`cursor-pointer underline-offset-2 ${effectiveView === "comprador" ? "font-medium underline" : "text-zinc-500 hover:underline"}`}
            >
              Ver como comprador
            </button>
            <button
              onClick={() => setView("bodega")}
              className={`cursor-pointer underline-offset-2 ${effectiveView === "bodega" ? "font-medium underline" : "text-zinc-500 hover:underline"}`}
            >
              Ver como bodeguero
            </button>
          </div>
        )}

        {effectiveView === "bodega" ? <BodegaOwnerPanel /> : <BuyerPanel />}
      </main>
    </div>
  );
}
