"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

/**
 * STUB — Passkey / ERC-4337 account abstraction login.
 *
 * Target flow (not implemented yet, deprioritized per product brief):
 *   1. Register/authenticate a WebAuthn passkey (Face ID / Touch ID) in the browser.
 *   2. Derive or fetch the user's ERC-4337 smart account (e.g. via a bundler/account
 *      SDK such as permissionless.js or an Account Kit), counterfactually deployed
 *      from the passkey's public key — no seed phrase ever shown to the user.
 *   3. Sponsor gas via a Paymaster on Arbitrum Sepolia so the bodega/payer never
 *      needs testnet ETH in their own wallet.
 *
 * For now this just falls back to a normal injected-wallet connect (see lib/wagmi.ts)
 * so the rest of the app (payments, fiado score) can be wired and demoed end-to-end
 * before the passkey/AA flow is built.
 */
export function PasskeyLogin() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{address.slice(0, 6)}...{address.slice(-4)}</span>
        <button onClick={() => disconnect()} className="underline">
          Desconectar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      disabled={isPending}
      className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
    >
      {isPending ? "Conectando..." : "Conectar wallet (TODO: reemplazar por Passkey/AA)"}
    </button>
  );
}
