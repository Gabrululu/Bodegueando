"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { Map, MapMarker, MarkerContent } from "@/components/ui/map";
import {
  beneficioTokenAbi,
  beneficioTokenAddress,
  groupOrdersAbi,
  groupOrdersAddress,
  paymentRouterAddress,
  rewardsCatalogAbi,
  rewardsCatalogAddress,
} from "@/lib/contracts";
import { useBodegaCore, useBodegaLocations, useGroupOrders, useNowSeconds, type GroupOrder } from "@/lib/bodega/hooks";
import {
  cardClass,
  highlightBoxClass,
  inputClass,
  mutedTextClass,
  numberInputClass,
  outlineButtonClass,
  primaryButtonClass,
  primaryButtonStyle,
  relativeDays,
  sectionTitleClass,
  textInputClass,
} from "@/lib/bodega/ui";
import { sendAndWait } from "@/lib/smartAccount";
import { formatPuntos, withStablecoinApproval } from "@/lib/stablecoin";
import { useExchangeRate } from "@/lib/useExchangeRate";
import type { TabProps } from "./types";

const REWARD_KIND_LABEL = ["Canje directo", "Sorteo"];

/** Mi red: compras conjuntas con bodegas cercanas, el catálogo de beneficios, el mapa y (si aplica) el panel de admin. */
export function RedTab(props: TabProps) {
  const { address } = props;
  const locations = useBodegaLocations(address);

  return (
    <div className="flex flex-col gap-6">
      <GroupOrdersSection {...props} locations={locations} />
      <RewardsSection {...props} />
      <LocationSection address={address} locations={locations} />
      <BeneficioAdminSection {...props} />
    </div>
  );
}

type Locations = ReturnType<typeof useBodegaLocations>;

function LocationSection({ address, locations }: { address: Address; locations: Locations }) {
  const { myLocation, setMyLocation, setSavedLocation } = locations;
  const [isLocating, setIsLocating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleLocateMe() {
    if (!navigator.geolocation) {
      setError("Tu navegador no soporta geolocalización.");
      return;
    }
    setIsLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setIsLocating(false);
      },
      () => {
        setError("No pudimos acceder a tu ubicación. Revisa los permisos del navegador.");
        setIsLocating(false);
      },
    );
  }

  async function handleSave() {
    if (!myLocation) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/bodega/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, lat: myLocation.lat, lng: myLocation.lng }),
      });
      if (!res.ok) throw new Error("failed");
      setSaved(true);
      setSavedLocation(myLocation);
    } catch {
      setError("No se pudo guardar tu ubicación. Intenta de nuevo.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section id="ubicacion" className={cardClass}>
      <h2 className={sectionTitleClass}>Tu ubicación en el mapa</h2>
      <p className={mutedTextClass}>
        Para que los clientes te encuentren en &quot;Bodegas cercanas&quot; y otras bodegas vean tus pedidos grupales.
        Arrastra el pin para ajustarlo si no cae exacto.
      </p>
      <div className="h-[260px] w-full overflow-hidden rounded-xl border border-black/10">
        <Map
          key={`${myLocation?.lat ?? "default"}-${myLocation?.lng ?? "default"}`}
          center={[myLocation?.lng ?? -77.0428, myLocation?.lat ?? -12.0464]}
          zoom={myLocation ? 15 : 11}
        >
          {myLocation && (
            <MapMarker
              longitude={myLocation.lng}
              latitude={myLocation.lat}
              draggable
              onDragEnd={({ lng, lat }) => setMyLocation({ lat, lng })}
            >
              <MarkerContent />
            </MapMarker>
          )}
        </Map>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={handleLocateMe} disabled={isLocating} className={outlineButtonClass}>
          {isLocating ? "Ubicando..." : "Usar mi ubicación actual"}
        </button>
        <button onClick={handleSave} disabled={isSaving || !myLocation} className={primaryButtonClass} style={primaryButtonStyle}>
          {isSaving ? "Guardando..." : "Guardar ubicación"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {saved && <p className="text-xs text-green-600">¡Listo! Ya apareces en el mapa ✓</p>}
    </section>
  );
}

function GroupOrdersSection({ address, client, navigate, locations }: TabProps & { locations: Locations }) {
  const { formatStablecoin, solesToStablecoin } = useExchangeRate();
  const core = useBodegaCore(address);
  const { orders, refetch } = useGroupOrders(address, locations.savedLocation, locations.locationsByAddress);
  const [title, setTitle] = useState("");
  const [goalSoles, setGoalSoles] = useState("500");
  const [pledgeDays, setPledgeDays] = useState("7");
  const [withdrawDays, setWithdrawDays] = useState("7");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [pledgeSolesByOrder, setPledgeSolesByOrder] = useState<Record<number, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<number | "all">(2);
  const now = useNowSeconds();

  if (!groupOrdersAddress) return null;

  const hasLocation = locations.savedLocation !== null;
  const filtering = hasLocation && radiusKm !== "all";
  const nearby = filtering ? orders.filter((o) => o.distanceFromMeKm !== null && o.distanceFromMeKm <= radiusKm) : orders;
  const withoutLocation = filtering ? orders.filter((o) => o.distanceFromMeKm === null) : [];

  async function run(id: number, calls: Parameters<typeof sendAndWait>[2], errorMessage: string) {
    if (!client) return;
    setBusyOrderId(id);
    setActionError(null);
    try {
      await sendAndWait(client, address, calls);
      refetch();
      core.refetchBalance();
    } catch {
      setActionError(errorMessage);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleCreate() {
    if (!client || !title.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    setCreateConfirmed(false);
    try {
      const goal = solesToStablecoin(goalSoles);
      const pledgeDeadline = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(Number(pledgeDays || "0"))) * 86400);
      const withdrawWindowSeconds = BigInt(Math.max(1, Math.round(Number(withdrawDays || "0"))) * 86400);
      await sendAndWait(client, address, [
        {
          address: groupOrdersAddress as Address,
          abi: groupOrdersAbi,
          functionName: "createGroupOrder",
          args: [title.trim(), goal, pledgeDeadline, withdrawWindowSeconds],
        },
      ]);
      setCreateConfirmed(true);
      setTitle("");
      refetch();
    } catch {
      setCreateError("No se pudo crear el pedido grupal. Intenta de nuevo.");
    } finally {
      setIsCreating(false);
    }
  }

  function handlePledge(id: number) {
    const amount = solesToStablecoin(pledgeSolesByOrder[id] ?? "");
    setPledgeSolesByOrder((prev) => ({ ...prev, [id]: "" }));
    return run(
      id,
      withStablecoinApproval(groupOrdersAddress as Address, amount, {
        address: groupOrdersAddress as Address,
        abi: groupOrdersAbi,
        functionName: "pledge",
        args: [BigInt(id), amount],
      }),
      "No se pudo aportar. Revisa que el pedido siga abierto y que tengas saldo.",
    );
  }

  const renderOrder = (o: GroupOrder) => {
    const pct = o.goal > BigInt(0) ? Math.min(100, Number((o.pledged * BigInt(100)) / o.goal)) : 0;
    const open = now <= o.pledgeDeadline;
    return (
      <div key={o.id} className={highlightBoxClass}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-[#0a0a0b]">{o.title}</p>
          {o.isMine && <span className="text-[11px] font-semibold uppercase tracking-wide text-[#718817]">Tu pedido</span>}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#c9e26540]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Avance hacia la meta">
          <div className="h-full rounded-full bg-[#718817]" style={{ width: `${pct}%` }} />
        </div>
        <p className={`mt-1 ${mutedTextClass}`}>
          {formatStablecoin(o.pledged)} de {formatStablecoin(o.goal)} ({pct}%) ·{" "}
          {o.withdrawn ? "retirado" : open ? `cierra ${relativeDays(o.pledgeDeadline, now)}` : "cerrado"}
          {o.distanceFromMeKm !== null ? ` · a ${o.distanceFromMeKm.toFixed(1)} km` : ""}
        </p>
        {o.myPledge > BigInt(0) && <p className={mutedTextClass}>Aportaste: {formatStablecoin(o.myPledge)}</p>}

        {!o.withdrawn && open && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-[#6b6d64]">S/</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={pledgeSolesByOrder[o.id] ?? ""}
              onChange={(e) => setPledgeSolesByOrder((prev) => ({ ...prev, [o.id]: e.target.value }))}
              className={numberInputClass}
            />
            <button onClick={() => handlePledge(o.id)} disabled={busyOrderId === o.id || !client} className={outlineButtonClass}>
              {busyOrderId === o.id ? "..." : "Aportar"}
            </button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {o.isMine && !o.withdrawn && !open && o.pledged >= o.goal && (
            <button
              onClick={() =>
                run(o.id, [{ address: groupOrdersAddress as Address, abi: groupOrdersAbi, functionName: "withdraw", args: [BigInt(o.id)] }], "No se pudo retirar. Revisa que el plazo para retirar siga vigente.")
              }
              disabled={busyOrderId === o.id || !client}
              className={primaryButtonClass}
              style={primaryButtonStyle}
            >
              {busyOrderId === o.id ? "Retirando..." : "Retirar el fondo"}
            </button>
          )}
          {o.myPledge > BigInt(0) && !o.withdrawn && !open && (
            <button
              onClick={() =>
                run(o.id, [{ address: groupOrdersAddress as Address, abi: groupOrdersAbi, functionName: "refund", args: [BigInt(o.id)] }], "Todavía no se puede reembolsar este pedido.")
              }
              disabled={busyOrderId === o.id || !client}
              className={outlineButtonClass}
            >
              {busyOrderId === o.id ? "..." : "Reclamar mi reembolso"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section id="pedidos" className={cardClass}>
      <h2 className={sectionTitleClass}>Compras conjuntas</h2>
      <p className={mutedTextClass}>
        Si tu distribuidor pide un mínimo que solo no alcanzas, junta el pedido con bodegas cercanas. Si se llega a la
        meta, la organizadora retira el fondo y compra; si no, cada una recupera lo suyo.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#0a0a0b]">Pedidos cerca de ti</p>
        <label className="flex items-center gap-2 text-xs text-[#6b6d64]">
          Radio
          <select
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-xl border border-black/15 bg-white px-2 py-1 text-xs text-[#0a0a0b] outline-none focus:border-black/35"
          >
            <option value={1}>1 km</option>
            <option value={2}>2 km</option>
            <option value={5}>5 km</option>
            <option value="all">Todos</option>
          </select>
        </label>
      </div>
      {!hasLocation && (
        <p className="text-xs text-[#8f9189]">
          Guarda tu ubicación para ver solo los pedidos de bodegas cercanas — mientras tanto se muestran todos.{" "}
          <button type="button" onClick={() => navigate("red", "ubicacion")} className="cursor-pointer underline">
            Guardar ubicación
          </button>
        </p>
      )}
      {nearby.length === 0 ? (
        <p className="text-xs text-[#8f9189]">No hay pedidos grupales {filtering ? "dentro de ese radio " : ""}todavía.</p>
      ) : (
        <div className="flex flex-col gap-2">{nearby.map(renderOrder)}</div>
      )}
      {withoutLocation.length > 0 && (
        <details className="text-xs text-[#8f9189]">
          <summary className="cursor-pointer">
            {withoutLocation.length} pedido{withoutLocation.length === 1 ? "" : "s"} más de bodegas sin ubicación registrada
          </summary>
          <div className="mt-2 flex flex-col gap-2">{withoutLocation.map(renderOrder)}</div>
        </details>
      )}
      {actionError && <p className="text-xs text-red-500">{actionError}</p>}

      <details className="rounded-xl border border-black/10 p-3">
        <summary className="cursor-pointer text-sm font-medium text-[#0a0a0b]">Organizar un pedido nuevo</summary>
        <div className="mt-3 flex flex-col gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Arroz + aceite — distribuidor de Miraflores" className={textInputClass} />
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-[#6b6d64]">Meta en soles</span>
            <input type="number" inputMode="decimal" min="0" step="10" value={goalSoles} onChange={(e) => setGoalSoles(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-[#6b6d64]">Se puede aportar por (días)</span>
            <input type="number" inputMode="numeric" min="1" step="1" value={pledgeDays} onChange={(e) => setPledgeDays(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-[#6b6d64]">Plazo para retirar (días)</span>
            <input type="number" inputMode="numeric" min="1" step="1" value={withdrawDays} onChange={(e) => setWithdrawDays(e.target.value)} className={numberInputClass} />
          </div>
          <button onClick={handleCreate} disabled={isCreating || !title.trim() || !client} className={primaryButtonClass} style={primaryButtonStyle}>
            {isCreating ? "Creando..." : "Organizar pedido grupal"}
          </button>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          {createConfirmed && <p className="text-xs text-green-600">¡Listo! Ya está publicado ✓</p>}
        </div>
      </details>
    </section>
  );
}

function RewardsSection({ address, client }: TabProps) {
  const { formatSolesFromUsd } = useExchangeRate();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"Instant" | "Raffle">("Instant");
  // 1 PUNTO = 1 USD de cashback (2% de cada compra), así que 2 PUNTOS ≈ S/ 340 en compras.
  const [costPuntos, setCostPuntos] = useState("2");
  const [availableDays, setAvailableDays] = useState("30");
  const [claimWindowHours, setClaimWindowHours] = useState("24");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [busyRewardId, setBusyRewardId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateConfirmed, setValidateConfirmed] = useState(false);
  const now = useNowSeconds();

  const countQuery = useReadContract({
    address: rewardsCatalogAddress,
    abi: rewardsCatalogAbi,
    functionName: "nextRewardId",
    query: { enabled: Boolean(rewardsCatalogAddress) },
  });
  const count = Number((countQuery.data as bigint | undefined) ?? BigInt(0));
  const rewardsQuery = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: rewardsCatalogAddress,
      abi: rewardsCatalogAbi,
      functionName: "rewards",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(rewardsCatalogAddress) && count > 0 },
  });

  if (!rewardsCatalogAddress) return null;

  const myRewards = (rewardsQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [rBodega, rTitle, rKind, pointCost, availableUntil, , active, drawn] = result.result as [
        Address,
        string,
        number,
        bigint,
        bigint,
        bigint,
        boolean,
        boolean,
        Address,
      ];
      return { id: i, bodega: rBodega, title: rTitle, kind: rKind, pointCost, availableUntil: Number(availableUntil), active, drawn };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => r.bodega.toLowerCase() === address.toLowerCase())
    .reverse();

  async function send(id: number | null, calls: Parameters<typeof sendAndWait>[2], errorMessage: string) {
    if (!client) return false;
    setBusyRewardId(id);
    setActionError(null);
    try {
      await sendAndWait(client, address, calls);
      rewardsQuery.refetch();
      return true;
    } catch {
      setActionError(errorMessage);
      return false;
    } finally {
      setBusyRewardId(null);
    }
  }

  async function handleCreate() {
    if (!client || !title.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    setCreateConfirmed(false);
    try {
      const availableUntil = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(Number(availableDays || "0"))) * 86400);
      const claimWindowSeconds = BigInt(Math.max(1, Math.round(Number(claimWindowHours || "0"))) * 3600);
      await sendAndWait(client, address, [
        {
          address: rewardsCatalogAddress as Address,
          abi: rewardsCatalogAbi,
          functionName: "createReward",
          args: [title.trim(), kind === "Instant" ? 0 : 1, parseEther(costPuntos || "0"), availableUntil, claimWindowSeconds],
        },
      ]);
      setCreateConfirmed(true);
      setTitle("");
      countQuery.refetch();
      rewardsQuery.refetch();
    } catch {
      setCreateError("No se pudo crear el beneficio. Intenta de nuevo.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleValidate() {
    if (!client || !redeemCode.trim()) return;
    setIsValidating(true);
    setValidateError(null);
    setValidateConfirmed(false);
    try {
      await sendAndWait(client, address, [
        { address: rewardsCatalogAddress as Address, abi: rewardsCatalogAbi, functionName: "fulfillRedemption", args: [BigInt(redeemCode.trim())] },
      ]);
      setValidateConfirmed(true);
      setRedeemCode("");
    } catch {
      setValidateError("Código inválido, vencido, o ya entregado.");
    } finally {
      setIsValidating(false);
    }
  }

  return (
    <section id="beneficios" className={cardClass}>
      <h2 className={sectionTitleClass}>Catálogo de beneficios</h2>
      <p className={mutedTextClass}>
        Ofrece algo a cambio de PUNTOS — un producto o un sorteo para una fecha especial. Cualquier cliente de la red
        puede canjearlo, no solo los que compran en tu bodega.
      </p>

      <div className="flex flex-col gap-2 rounded-xl border border-black/10 p-3">
        <label htmlFor="redeemCode" className="text-sm font-medium text-[#0a0a0b]">
          Entregar un canje en el mostrador
        </label>
        <input id="redeemCode" inputMode="numeric" value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} placeholder="Código del canje" className={inputClass} />
        <button onClick={handleValidate} disabled={isValidating || !redeemCode.trim() || !client} className={outlineButtonClass}>
          {isValidating ? "Validando..." : "Validar y entregar"}
        </button>
        {validateError && <p className="text-xs text-red-500">{validateError}</p>}
        {validateConfirmed && <p className="text-xs text-green-600">¡Listo! Canje entregado ✓</p>}
      </div>

      {myRewards.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-[#0a0a0b]">Tus beneficios publicados</p>
          {myRewards.map((r) => (
            <div key={r.id} className={highlightBoxClass}>
              <p className="text-sm font-medium text-[#0a0a0b]">{r.title}</p>
              <p className={mutedTextClass}>
                {REWARD_KIND_LABEL[r.kind]} · {formatPuntos(r.pointCost)} PUNTOS (vale {formatSolesFromUsd(Number(r.pointCost) / 1e18)}) ·{" "}
                {r.active ? `activo, ${r.availableUntil > now ? `cierra ${relativeDays(r.availableUntil, now)}` : "cerrado"}` : "pausado"}
                {r.kind === 1 && r.drawn ? " · sorteado" : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    send(r.id, [{ address: rewardsCatalogAddress as Address, abi: rewardsCatalogAbi, functionName: "setRewardActive", args: [BigInt(r.id), !r.active] }], "No se pudo actualizar el beneficio. Intenta de nuevo.")
                  }
                  disabled={busyRewardId === r.id || !client}
                  className={outlineButtonClass}
                >
                  {busyRewardId === r.id ? "..." : r.active ? "Pausar" : "Reactivar"}
                </button>
                {r.kind === 1 && !r.drawn && r.availableUntil <= now && (
                  <button
                    onClick={() =>
                      send(r.id, [{ address: rewardsCatalogAddress as Address, abi: rewardsCatalogAbi, functionName: "drawWinner", args: [BigInt(r.id)] }], "No se pudo sortear. Revisa que haya participantes.")
                    }
                    disabled={busyRewardId === r.id || !client}
                    className={primaryButtonClass}
                    style={primaryButtonStyle}
                  >
                    {busyRewardId === r.id ? "Sorteando..." : "Sortear ganador"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {actionError && <p className="text-xs text-red-500">{actionError}</p>}
        </div>
      )}

      <details className="rounded-xl border border-black/10 p-3">
        <summary className="cursor-pointer text-sm font-medium text-[#0a0a0b]">Publicar un beneficio nuevo</summary>
        <div className="mt-3 flex flex-col gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: 1kg de arroz, o Canasta navideña" className={textInputClass} />
          <div className="flex gap-2">
            {(["Instant", "Raffle"] as const).map((k, i) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`flex-1 cursor-pointer rounded-xl border px-3 py-2 text-xs font-medium ${kind === k ? "border-black/35 bg-[#c9e26514]" : "border-black/15"}`}
              >
                {REWARD_KIND_LABEL[i]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-[#6b6d64]">Costo en PUNTOS</span>
            <input type="number" inputMode="decimal" min="0" step="0.5" value={costPuntos} onChange={(e) => setCostPuntos(e.target.value)} className={numberInputClass} />
          </div>
          <p className={mutedTextClass}>
            Equivale a {formatSolesFromUsd(Number(costPuntos || 0))} en puntos — un cliente los junta comprando unos{" "}
            {formatSolesFromUsd(Number(costPuntos || 0) * 50)}.
          </p>
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-[#6b6d64]">{kind === "Instant" ? "Disponible por (días)" : "Cierra el sorteo en (días)"}</span>
            <input type="number" inputMode="numeric" min="1" step="1" value={availableDays} onChange={(e) => setAvailableDays(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-[#6b6d64]">Código válido por (horas)</span>
            <input type="number" inputMode="numeric" min="1" step="1" value={claimWindowHours} onChange={(e) => setClaimWindowHours(e.target.value)} className={numberInputClass} />
          </div>
          <button onClick={handleCreate} disabled={isCreating || !title.trim() || !client} className={primaryButtonClass} style={primaryButtonStyle}>
            {isCreating ? "Creando..." : "Publicar beneficio"}
          </button>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          {createConfirmed && <p className="text-xs text-green-600">¡Listo! Ya está en el catálogo ✓</p>}
        </div>
      </details>
    </section>
  );
}

/** Solo lo ve la cuenta dueña de BeneficioToken (el programa social); on-chain igual está protegido por onlyOwner. */
function BeneficioAdminSection({ address, client }: TabProps) {
  const [beneficiaryCode, setBeneficiaryCode] = useState("");
  const [beneficiaryAddress, setBeneficiaryAddress] = useState<Address | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [amountSoles, setAmountSoles] = useState("50");
  const [durationDays, setDurationDays] = useState("30");
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueConfirmed, setIssueConfirmed] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncConfirmed, setSyncConfirmed] = useState(false);

  const ownerQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "owner",
    query: { enabled: Boolean(beneficioTokenAddress) },
  });
  const registryQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "bodegaRegistry",
    query: { enabled: Boolean(beneficioTokenAddress) },
  });
  const isAdmin = Boolean(ownerQuery.data) && (ownerQuery.data as string).toLowerCase() === address.toLowerCase();
  const registryOutOfSync =
    Boolean(registryQuery.data) &&
    Boolean(paymentRouterAddress) &&
    (registryQuery.data as string).toLowerCase() !== (paymentRouterAddress as string).toLowerCase();

  const isValidCode = /^\d{6,9}$/.test(beneficiaryCode.trim());
  useEffect(() => {
    if (!isValidCode) return;
    const code = beneficiaryCode.trim();
    let cancelled = false;
    (async () => {
      setIsResolving(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}&pool=buyer`);
        const data = await res.json();
        if (cancelled) return;
        setBeneficiaryAddress(data.address ? (data.address as Address) : undefined);
        setNotFound(!data.address);
      } catch {
        if (!cancelled) {
          setBeneficiaryAddress(undefined);
          setNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [beneficiaryCode, isValidCode]);

  if (!beneficioTokenAddress || !isAdmin) return null;

  function handleCodeChange(value: string) {
    const trimmed = value.trim();
    setBeneficiaryCode(trimmed);
    if (!/^\d{6,9}$/.test(trimmed)) {
      setBeneficiaryAddress(undefined);
      setNotFound(false);
    }
  }

  async function handleSyncRegistry() {
    if (!client || !paymentRouterAddress) return;
    setIsSyncing(true);
    setSyncError(null);
    setSyncConfirmed(false);
    try {
      await sendAndWait(client, address, [
        { address: beneficioTokenAddress as Address, abi: beneficioTokenAbi, functionName: "setBodegaRegistry", args: [paymentRouterAddress] },
      ]);
      setSyncConfirmed(true);
      registryQuery.refetch();
    } catch {
      setSyncError("No se pudo actualizar. Intenta de nuevo.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleIssue() {
    if (!beneficiaryAddress || !client) return;
    setIsIssuing(true);
    setIssueError(null);
    setIssueConfirmed(false);
    try {
      // BeneficioToken: 1 unidad (18 decimales) = S/ 1 de beneficio.
      const amount = parseEther((amountSoles || "0").trim() || "0");
      const days = Math.max(1, Math.round(Number(durationDays || "0")));
      await sendAndWait(client, address, [
        { address: beneficioTokenAddress as Address, abi: beneficioTokenAbi, functionName: "issue", args: [beneficiaryAddress, amount, BigInt(days * 86400)] },
      ]);
      setIssueConfirmed(true);
      setBeneficiaryCode("");
      setBeneficiaryAddress(undefined);
    } catch {
      setIssueError("No se pudo emitir el beneficio. Intenta de nuevo.");
    } finally {
      setIsIssuing(false);
    }
  }

  return (
    <section id="admin" className={cardClass}>
      <h2 className={sectionTitleClass}>Administrador — Beneficios sociales</h2>
      <p className={mutedTextClass}>
        Solo tú ves esta sección: tu cuenta es la autorizada para emitir beneficios sociales (programas como Vaso de
        Leche o Pensión 65). Cada sol emitido solo se puede gastar en una bodega registrada.
      </p>
      {registryOutOfSync && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-50 p-3">
          <p className={mutedTextClass}>
            La lista de bodegas que usa el sistema de beneficios quedó desactualizada. Actualízala para que las bodegas
            nuevas puedan recibir beneficios.
          </p>
          <button onClick={handleSyncRegistry} disabled={isSyncing || !client} className={`${outlineButtonClass} mt-2`}>
            {isSyncing ? "Actualizando..." : "Actualizar registro de bodegas"}
          </button>
          {syncError && <p className="mt-1 text-xs text-red-500">{syncError}</p>}
          {syncConfirmed && <p className="mt-1 text-xs text-green-600">¡Listo! Registro actualizado ✓</p>}
        </div>
      )}
      <label htmlFor="beneficiaryCode" className="text-sm font-medium text-[#0a0a0b]">
        Código del beneficiario
      </label>
      <input id="beneficiaryCode" inputMode="numeric" value={beneficiaryCode} onChange={(e) => handleCodeChange(e.target.value)} placeholder="Su código" className={inputClass} />
      {isResolving && <p className={mutedTextClass}>Buscando...</p>}
      {notFound && <p className="text-xs text-red-500">No encontramos ese código.</p>}
      {beneficiaryAddress && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-sm text-[#6b6d64]">Monto S/</span>
            <input type="number" inputMode="decimal" min="0" step="1" value={amountSoles} onChange={(e) => setAmountSoles(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-sm text-[#6b6d64]">Vence en (días)</span>
            <input type="number" inputMode="numeric" min="1" step="1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className={numberInputClass} />
          </div>
          <button onClick={handleIssue} disabled={isIssuing || !client} className={primaryButtonClass} style={primaryButtonStyle}>
            {isIssuing ? "Emitiendo..." : "Emitir beneficio"}
          </button>
        </>
      )}
      {issueError && <p className="text-xs text-red-500">{issueError}</p>}
      {issueConfirmed && <p className="text-xs text-green-600">¡Listo! Ya se emitió el beneficio ✓</p>}
    </section>
  );
}
