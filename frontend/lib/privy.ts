import type { PrivyClientConfig } from "@privy-io/react-auth";
import { arbitrumSepolia } from "viem/chains";

/**
 * Login solo por teléfono o correo — nunca "conecta tu wallet". La wallet embebida se crea
 * sola en el primer login, sin que el usuario la vea ni sepa que existe.
 */
export const privyConfig: PrivyClientConfig = {
  loginMethods: ["email", "sms"],
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  appearance: {
    showWalletLoginFirst: false,
  },
  defaultChain: arbitrumSepolia,
  supportedChains: [arbitrumSepolia],
};
