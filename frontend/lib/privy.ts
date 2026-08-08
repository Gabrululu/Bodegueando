import type { PrivyClientConfig } from "@privy-io/react-auth";
import { arbitrumSepolia } from "viem/chains";

/**
 * Login por teléfono, correo o passkey — nunca "conecta tu wallet". La wallet embebida se
 * crea sola en el primer login, sin que el usuario la vea ni sepa que existe. Passkey usa la
 * misma wallet embebida como firmante que SMS/correo (ver lib/smartAccount.ts) — es solo un
 * método de autenticación distinto, no cambia qué firma las transacciones.
 */
export const privyConfig: PrivyClientConfig = {
  loginMethods: ["email", "sms", "passkey"],
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
