"use client";

import { usePrivy } from "@privy-io/react-auth";

/**
 * Login por teléfono o correo (Privy), nunca "conecta tu wallet" — la wallet embebida se
 * crea sola detrás de escena en el primer login (ver lib/privy.ts). El usuario nunca ve la
 * palabra "wallet" ni una dirección acá.
 */
export function Login() {
  const { ready, authenticated, login, logout, user } = usePrivy();

  if (!ready) {
    return null;
  }

  if (authenticated) {
    const label = user?.email?.address ?? user?.phone?.number ?? "Tu cuenta";
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[#6b6d64]">{label}</span>
        <button onClick={() => logout()} className="cursor-pointer text-[#0a0a0b] underline underline-offset-2">
          Salir
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => login()}
      className="cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition-transform hover:-translate-y-0.5"
      style={{
        background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)",
        boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
      }}
    >
      Ingresar
    </button>
  );
}
