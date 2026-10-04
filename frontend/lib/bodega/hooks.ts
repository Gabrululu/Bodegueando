"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import {
  creditLineAbi,
  creditLineAddress,
  fiadoScoringAbi,
  fiadoScoringAddress,
  groupOrdersAbi,
  groupOrdersAddress,
  invoiceEscrowAbi,
  invoiceEscrowAddress,
  stablecoinAbi,
  stablecoinAddress,
} from "@/lib/contracts";
import { distanceKm } from "@/lib/distance";

/**
 * Lecturas que usan varias pestañas del panel de bodega. wagmi cachea por (contrato, función,
 * args), así que si Inicio y Fiado llaman al mismo hook comparten una sola consulta, y un
 * refetch en una pestaña actualiza la otra — no hace falta pasar datos por props.
 */

const sameAddress = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Score, límite y estado de fiado de la bodega, más su saldo en USDG. */
export function useBodegaCore(address: Address | null) {
  const enabled = Boolean(address && fiadoScoringAddress);
  const args = address ? ([address] as const) : undefined;

  const fiadoEnabledQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "isFiadoEnabled",
    args,
    query: { enabled },
  });
  const scoreQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getScore",
    args,
    query: { enabled },
  });
  const limitQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getCreditLimit",
    args,
    query: { enabled },
  });
  const aiInfoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAiAdjustmentInfo",
    args,
    query: { enabled },
  });
  const totalOutstandingQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getTotalOutstanding",
    args,
    query: { enabled },
  });
  const availableFiadoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAvailableFiado",
    args,
    query: { enabled },
  });
  const balanceQuery = useReadContract({
    address: stablecoinAddress,
    abi: stablecoinAbi,
    functionName: "balanceOf",
    args,
    query: { enabled: Boolean(address) },
  });

  const toUsd = (value: unknown) => Number((value as bigint | undefined) ?? BigInt(0)) / 1e18;

  const refetch = () => {
    fiadoEnabledQuery.refetch();
    scoreQuery.refetch();
    limitQuery.refetch();
    aiInfoQuery.refetch();
    totalOutstandingQuery.refetch();
    availableFiadoQuery.refetch();
    balanceQuery.refetch();
  };

  return {
    fiadoEnabled: fiadoEnabledQuery.data === true,
    fiadoEnabledLoading: fiadoEnabledQuery.isLoading,
    score: Number((scoreQuery.data as bigint | undefined) ?? BigInt(0)),
    scoreLoading: scoreQuery.isLoading,
    // FiadoScoring guarda todo en USD con 18 decimales (ver StablecoinSettlement).
    limitUsd: toUsd(limitQuery.data),
    limitLoading: limitQuery.isLoading,
    aiAdjusted: Boolean((aiInfoQuery.data as [boolean, bigint] | undefined)?.[0]),
    outstandingUsd: toUsd(totalOutstandingQuery.data),
    outstandingLoading: totalOutstandingQuery.isLoading,
    availableUsd: toUsd(availableFiadoQuery.data),
    availableLoading: availableFiadoQuery.isLoading,
    balance: (balanceQuery.data as bigint | undefined) ?? BigInt(0),
    balanceLoading: balanceQuery.isLoading,
    refetchBalance: balanceQuery.refetch,
    refetch,
  };
}

export const INVOICE_STATUS = { Proposed: 0, Active: 1, Repaid: 2, Defaulted: 3, Cancelled: 4 } as const;
export const INVOICE_STATUS_LABEL = ["Propuesta", "Activa", "Pagada", "Vencida — reclamada", "Cancelada"];

/** Facturas con garantía (InvoiceEscrow) donde esta cuenta es la bodega. */
export function useMyInvoices(address: Address | null) {
  const countQuery = useReadContract({
    address: invoiceEscrowAddress,
    abi: invoiceEscrowAbi,
    functionName: "nextInvoiceId",
    query: { enabled: Boolean(invoiceEscrowAddress) },
  });
  const count = Number((countQuery.data as bigint | undefined) ?? BigInt(0));

  const listQuery = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: invoiceEscrowAddress,
      abi: invoiceEscrowAbi,
      functionName: "invoices",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(invoiceEscrowAddress) && count > 0 },
  });

  const invoices = (listQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [bodega, customer, principal, collateral, repaidAmount, dueDate, status] = result.result as [
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        number,
      ];
      return { id: i, bodega, customer, principal, collateral, repaidAmount, dueDate: Number(dueDate), status };
    })
    .filter((inv): inv is NonNullable<typeof inv> => inv !== null)
    .filter((inv) => sameAddress(inv.bodega, address ?? undefined))
    .reverse();

  return {
    invoices,
    isLoading: countQuery.isLoading || listQuery.isLoading,
    refetch: () => {
      countQuery.refetch();
      listQuery.refetch();
    },
  };
}

/** Préstamos de CreditLine todavía sin resolver de esta bodega. */
export function useMyLoans(address: Address | null) {
  const countQuery = useReadContract({
    address: creditLineAddress,
    abi: creditLineAbi,
    functionName: "nextLoanId",
    query: { enabled: Boolean(creditLineAddress) },
  });
  const count = Number((countQuery.data as bigint | undefined) ?? BigInt(0));

  const listQuery = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: creditLineAddress,
      abi: creditLineAbi,
      functionName: "loans",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(creditLineAddress) && count > 0 },
  });

  const loans = (listQuery.data ?? [])
    .map((r, i) => {
      if (r.status !== "success") return null;
      const [bodega, principal, collateral, interestBps, dueDate, resolved] = r.result as [
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ];
      // Misma fórmula que CreditLine.amountOwed.
      const owed = principal + (principal * interestBps) / BigInt(10_000);
      return { id: i, bodega, principal, collateral, interestBps, owed, dueDate: Number(dueDate), resolved };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .filter((l) => sameAddress(l.bodega, address ?? undefined) && !l.resolved)
    .reverse();

  return {
    loans,
    refetch: () => {
      countQuery.refetch();
      listQuery.refetch();
    },
  };
}

export type GroupOrder = {
  id: number;
  organizer: Address;
  title: string;
  goal: bigint;
  pledged: bigint;
  pledgeDeadline: number;
  withdrawWindowSeconds: number;
  withdrawn: boolean;
  myPledge: bigint;
  isMine: boolean;
  distanceFromMeKm: number | null;
};

/** Todos los pedidos grupales, con mi aporte y la distancia a la organizadora (si se sabe). */
export function useGroupOrders(
  address: Address | null,
  myLocation: { lat: number; lng: number } | null,
  locationsByAddress: Record<string, { lat: number; lng: number }>,
) {
  const countQuery = useReadContract({
    address: groupOrdersAddress,
    abi: groupOrdersAbi,
    functionName: "nextGroupOrderId",
    query: { enabled: Boolean(groupOrdersAddress) },
  });
  const count = Number((countQuery.data as bigint | undefined) ?? BigInt(0));

  const listQuery = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: groupOrdersAddress,
      abi: groupOrdersAbi,
      functionName: "groupOrders",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(groupOrdersAddress) && count > 0 },
  });

  const myPledgesQuery = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: groupOrdersAddress,
      abi: groupOrdersAbi,
      functionName: "pledges",
      args: [BigInt(i), address ?? "0x0000000000000000000000000000000000000000"],
    })),
    query: { enabled: Boolean(groupOrdersAddress) && count > 0 && Boolean(address) },
  });

  const orders: GroupOrder[] = (listQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [organizer, title, goal, pledged, pledgeDeadline, withdrawWindowSeconds, withdrawn] = result.result as [
        Address,
        string,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ];
      const pledgeResult = myPledgesQuery.data?.[i];
      const myPledge = pledgeResult?.status === "success" ? (pledgeResult.result as bigint) : BigInt(0);
      const organizerLocation = locationsByAddress[organizer.toLowerCase()];
      const distanceFromMeKm =
        myLocation && organizerLocation
          ? distanceKm(myLocation.lat, myLocation.lng, organizerLocation.lat, organizerLocation.lng)
          : null;
      return {
        id: i,
        organizer,
        title,
        goal,
        pledged,
        pledgeDeadline: Number(pledgeDeadline),
        withdrawWindowSeconds: Number(withdrawWindowSeconds),
        withdrawn,
        myPledge,
        isMine: sameAddress(organizer, address ?? undefined),
        distanceFromMeKm,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .reverse();

  return {
    orders,
    refetch: () => {
      countQuery.refetch();
      listQuery.refetch();
      myPledgesQuery.refetch();
    },
  };
}

/** Ubicación guardada de esta bodega y de todas las demás (metadata de UX, vive en Redis). */
export function useBodegaLocations(address: Address | null) {
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [savedLocation, setSavedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationsByAddress, setLocationsByAddress] = useState<Record<string, { lat: number; lng: number }>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/bodega/location?address=${address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.location) {
          const loc = { lat: data.location.lat, lng: data.location.lng };
          setMyLocation(loc);
          setSavedLocation(loc);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, [address]);

  useEffect(() => {
    fetch("/api/bodega/location")
      .then((res) => res.json())
      .then((data) => {
        const byAddress: Record<string, { lat: number; lng: number }> = {};
        for (const loc of data.locations ?? []) {
          byAddress[(loc.address as string).toLowerCase()] = { lat: loc.lat, lng: loc.lng };
        }
        setLocationsByAddress(byAddress);
      })
      .catch(() => {});
  }, []);

  return { myLocation, setMyLocation, savedLocation, setSavedLocation, locationsByAddress, isLoaded };
}

/** Si la bodega ya vinculó Telegram. `null` mientras no se sabe. */
export function useTelegramLinked(address: Address | null) {
  const [linked, setLinked] = useState<boolean | null>(null);

  const fetchLinked = useCallback(async (): Promise<boolean | null> => {
    if (!address) return null;
    try {
      const res = await fetch(`/api/telegram/status?bodegaAddress=${address}`);
      const data = await res.json();
      return Boolean(data.linked);
    } catch {
      return null;
    }
  }, [address]);

  const refresh = useCallback(async () => {
    const value = await fetchLinked();
    setLinked(value);
    return value;
  }, [fetchLinked]);

  useEffect(() => {
    let cancelled = false;
    fetchLinked().then((value) => {
      if (!cancelled) setLinked(value);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLinked]);

  return { linked, refresh };
}

/**
 * Hora actual en segundos, refrescada cada minuto — para "vence en 3 días", vencimientos y
 * pendientes, sin leer el reloj durante el render.
 */
export function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Código permanente de 6+ dígitos de la bodega (el del QR). */
export function useBodegaCode(address: Address | null) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    fetch("/api/bodega/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, pool: "bodega" }),
    })
      .then((res) => res.json())
      .then((data) => setCode(data.code ?? null))
      .catch(() => setCode(null));
  }, [address]);
  return code;
}
