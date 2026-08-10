"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { privyConfig } from "@/lib/privy";

/**
 * WalletConnect's internal debug logger (bundled by Privy for detecting injected wallets)
 * tries to open an IndexedDB store for its own debug console. In some browser contexts that
 * throws a DOMException("Internal error", "UnknownError") as an unhandled rejection — it never
 * touches app state, but Next's dev overlay treats any unhandled rejection as a full-page
 * crash. Only swallow this exact, narrowly-matched DOMException; everything else still
 * propagates normally.
 */
function useSuppressWalletConnectLoggerNoise() {
  useEffect(() => {
    function handler(event: PromiseRejectionEvent) {
      const reason = event.reason;
      if (reason instanceof DOMException && reason.name === "UnknownError") {
        event.preventDefault();
      }
    }
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useSuppressWalletConnectLoggerNoise();
  const [queryClient] = useState(() => new QueryClient());
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!privyAppId) {
    return (
      <p className="p-8 text-center text-sm text-[#6b6d64]">
        Falta configurar NEXT_PUBLIC_PRIVY_APP_ID.
      </p>
    );
  }

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
