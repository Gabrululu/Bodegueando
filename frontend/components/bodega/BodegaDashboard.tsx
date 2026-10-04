"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight, Home, Landmark, NotebookPen, QrCode, Users } from "lucide-react";
import { fiadoScoringAddress, paymentRouterAddress, STABLECOIN_DECIMALS } from "@/lib/contracts";
import { useBodegaCode, useBodegaCore } from "@/lib/bodega/hooks";
import { useBodegaProfile } from "@/lib/bodega/profile";
import type { Address } from "viem";
import type { SmartAccountClient } from "permissionless";
import { useSmartAccountClient } from "@/lib/smartAccount";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { CobrarTab } from "./CobrarTab";
import { CreditoTab } from "./CreditoTab";
import { FiadoTab } from "./FiadoTab";
import { BodegaAvatar } from "./BodegaAvatar";
import { InicioTab } from "./InicioTab";
import { PerfilTab } from "./PerfilTab";
import { RedTab } from "./RedTab";
import type { BodegaTab, TabProps } from "./types";

const TABS: Array<{ id: BodegaTab; label: string; Icon: typeof Home }> = [
  { id: "inicio", label: "Inicio", Icon: Home },
  { id: "cobrar", label: "Cobrar", Icon: QrCode },
  { id: "fiado", label: "Fiado", Icon: NotebookPen },
  { id: "credito", label: "Crédito", Icon: Landmark },
  { id: "red", label: "Mi red", Icon: Users },
];

function isTab(value: string | null): value is BodegaTab {
  return value === "perfil" || TABS.some((t) => t.id === value);
}

const TAB_CHANGE_EVENT = "bodega:tabchange";

function tabFromUrl(): BodegaTab {
  const value = new URLSearchParams(window.location.search).get("tab");
  return isTab(value) ? value : "inicio";
}

/** La URL es la fuente de verdad de la pestaña: "atrás"/"adelante" (popstate) y navigate(). */
function subscribeToTab(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(TAB_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(TAB_CHANGE_EVENT, onChange);
  };
}

/**
 * Panel del bodeguero, organizado en cinco áreas en vez de una sola columna larga. La pestaña
 * vive en la URL (`/app?tab=fiado`), así que "atrás" funciona y se puede compartir o mandar por
 * Telegram un link directo a una sección. Solo se monta la pestaña activa, así que solo se
 * consulta lo que se está viendo.
 */
export function BodegaDashboard() {
  const { client, address, isLoading: isAccountLoading, signAsOwner } = useSmartAccountClient();

  if (!address) {
    return (
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
        {isAccountLoading ? "Preparando tu cuenta…" : "Ingresa arriba para ver tu bodega."}
      </p>
    );
  }

  return <BodegaDashboardView address={address} client={client} signAsOwner={signAsOwner} />;
}

/** El panel en sí, para una cuenta ya conocida (separado de cómo se obtiene la cuenta). */
export function BodegaDashboardView({
  address,
  client,
  signAsOwner = null,
}: {
  address: Address;
  client: SmartAccountClient | null;
  signAsOwner?: TabProps["signAsOwner"];
}) {
  const tab = useSyncExternalStore(subscribeToTab, tabFromUrl, () => "inicio" as const);
  const [anchor, setAnchor] = useState<string | null>(null);
  const core = useBodegaCore(address);
  const bodegaCode = useBodegaCode(address);
  const profile = useBodegaProfile(address);
  const { formatStablecoin } = useExchangeRate();

  const navigate = useCallback((next: BodegaTab, nextAnchor?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(TAB_CHANGE_EVENT));
    setAnchor(nextAnchor ?? null);
    if (!nextAnchor) window.scrollTo({ top: 0 });
  }, []);

  // Llevar a la sección pedida una vez que la pestaña nueva se pintó.
  useEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, anchor]);

  // Una bodega también necesita saldo propio para aportar a pedidos grupales o poner la
  // garantía de un préstamo, así que pide el mismo saldo de prueba que un comprador.
  useEffect(() => {
    if (!address) return;
    fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.funded) core.refetchBalance();
      })
      .catch((err) => console.error("[faucet] request failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!fiadoScoringAddress || !paymentRouterAddress) {
    return (
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
        La app todavía no está conectada a los contratos. Avísale a soporte.
      </p>
    );
  }

  const tabProps: TabProps = { address, client, navigate, signAsOwner };
  const usd = Number(core.balance) / 10 ** STABLECOIN_DECIMALS;

  return (
    <div className="flex w-full flex-col gap-6 pb-24 text-left lg:flex-row lg:items-start lg:gap-8 lg:pb-0">
      <nav
        aria-label="Secciones de tu bodega"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-[#fffffc]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:sticky lg:top-6 lg:w-52 lg:shrink-0 lg:rounded-[20px] lg:border lg:p-2 lg:pb-2 lg:shadow-sm"
      >
        <ul className="mx-auto flex max-w-md justify-around lg:max-w-none lg:flex-col lg:gap-1">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <li key={id} className="flex-1 lg:flex-none">
                <button
                  type="button"
                  onClick={() => navigate(id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-sm ${
                    active ? "text-[#0a0a0b] lg:bg-[#c9e265]" : "text-[#8a8c81] hover:text-[#0a0a0b] lg:hover:bg-black/[0.04]"
                  }`}
                >
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full lg:h-auto lg:w-auto ${active ? "bg-[#c9e265] lg:bg-transparent" : ""}`}>
                    <Icon aria-hidden className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-black/10 bg-[#fffffc] px-5 py-4 shadow-sm">
          <button
            type="button"
            onClick={() => navigate("perfil")}
            className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-xl text-left"
            aria-label="Ver y editar el perfil de tu bodega"
          >
            <BodegaAvatar address={address} profile={profile.data} />
            <span className="min-w-0">
              {profile.data?.name ? (
                <>
                  <span className="block truncate text-base font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                    {profile.data.name}
                  </span>
                  <span className="block text-xs text-[#6b6d64]">
                    Código #{bodegaCode ?? "…"} · <span className="underline-offset-2 group-hover:underline">Editar perfil</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-base font-semibold text-[#0a0a0b]">Bodega #{bodegaCode ?? "…"}</span>
                  <span className="flex items-center gap-0.5 text-xs font-medium text-[#718817]">
                    Ponle nombre y logo a tu bodega <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                  </span>
                </>
              )}
            </span>
          </button>
          <div className="text-right">
            <p className="text-xs text-[#6b6d64]">Tu saldo</p>
            <p className="text-xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              {core.balanceLoading ? "…" : formatStablecoin(core.balance)}
            </p>
            <p className="text-[11px] text-[#8a8c81]">{core.balanceLoading ? "" : `≈ US$ ${usd.toFixed(2)} en dólares digitales`}</p>
          </div>
        </header>

        {tab === "inicio" && <InicioTab {...tabProps} />}
        {tab === "cobrar" && <CobrarTab {...tabProps} />}
        {tab === "fiado" && <FiadoTab {...tabProps} />}
        {tab === "credito" && <CreditoTab {...tabProps} />}
        {tab === "red" && <RedTab {...tabProps} />}
        {tab === "perfil" && <PerfilTab {...tabProps} />}
      </div>
    </div>
  );
}
