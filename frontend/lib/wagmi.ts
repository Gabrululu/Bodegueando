import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";

/**
 * No connectors array here — Privy's WagmiProvider (see app/providers.tsx) attaches the
 * embedded-wallet connector automatically once someone logs in. There's never a "connect
 * wallet" button; wagmi just picks up whatever Privy has authenticated.
 */
export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http(
      process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0],
    ),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
