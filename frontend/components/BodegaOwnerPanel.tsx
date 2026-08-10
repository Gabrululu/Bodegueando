"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { QRCodeSVG } from "qrcode.react";
import { Map, MapMarker, MarkerContent } from "@/components/ui/map";
import {
  fiadoScoringAbi,
  fiadoScoringAddress,
  paymentRouterAddress,
  beneficioTokenAbi,
  beneficioTokenAddress,
  invoiceEscrowAbi,
  invoiceEscrowAddress,
  rewardsCatalogAbi,
  rewardsCatalogAddress,
  groupOrdersAbi,
  groupOrdersAddress,
  creditCertificateAbi,
  creditCertificateAddress,
  creditLineAbi,
  creditLineAddress,
} from "@/lib/contracts";
import { RISK_COLOR, RISK_LABEL, confianzaLabel, type AiRecommendation } from "@/lib/fiado";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { sendAndWait, useSmartAccountClient } from "@/lib/smartAccount";
import { distanceKm } from "@/lib/distance";

/**
 * Vista del bodeguero: su propio código para cobrar, el interruptor de fiado, y
 * cuánto fiado le está ofreciendo la app a sus clientes ahora mismo (con opción de
 * refrescarlo con IA). Nada de esto lo ve un comprador — ver BuyerPanel.tsx.
 */
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

const cardClass = "flex flex-col gap-3 rounded-[20px] border border-black/10 bg-[#fffffc] p-5 shadow-sm";
const sectionTitleClass =
  "text-sm font-semibold uppercase tracking-wide text-[#6b6d64] [font-family:var(--font-bricolage)]";
const inputClass =
  "rounded-xl border border-black/15 bg-white px-3 py-2 text-center text-lg font-semibold tracking-widest text-[#0a0a0b] outline-none focus:border-black/35";
const primaryButtonClass =
  "cursor-pointer rounded-full px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const primaryButtonStyle = {
  background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)",
  boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
};
const outlineButtonClass =
  "cursor-pointer rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50";
const highlightBoxClass = "rounded-xl border border-black/5 bg-[#c9e26514] p-4";

function formatPaymentDate(unixSeconds: number): string {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleString("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BodegaOwnerPanel() {
  const { client: smartAccountClient, address, isLoading: isAccountLoading } = useSmartAccountClient();
  const [copied, setCopied] = useState(false);
  const [isTogglePending, setIsTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ recommendation: AiRecommendation; txHash: string | null } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [bodegaCode, setBodegaCode] = useState<string | null>(null);
  const [customerCodeInput, setCustomerCodeInput] = useState("");
  const [customerAddress, setCustomerAddress] = useState<Address | undefined>(undefined);
  const [isResolvingCustomer, setIsResolvingCustomer] = useState(false);
  const [customerNotFound, setCustomerNotFound] = useState(false);
  const [fiarAmountSoles, setFiarAmountSoles] = useState("10");
  const [isFiarSubmitting, setIsFiarSubmitting] = useState(false);
  const [fiarError, setFiarError] = useState<string | null>(null);
  const [fiarConfirmed, setFiarConfirmed] = useState(false);
  const [escrowPrincipalSoles, setEscrowPrincipalSoles] = useState("50");
  const [escrowCollateralSoles, setEscrowCollateralSoles] = useState("15");
  const [escrowDueDays, setEscrowDueDays] = useState("15");
  const [isProposing, setIsProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeConfirmed, setProposeConfirmed] = useState(false);
  const [claimingInvoiceId, setClaimingInvoiceId] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [rewardTitle, setRewardTitle] = useState("");
  const [rewardKind, setRewardKind] = useState<"Instant" | "Raffle">("Instant");
  const [rewardCostPuntos, setRewardCostPuntos] = useState("100");
  const [rewardAvailableDays, setRewardAvailableDays] = useState("30");
  const [rewardClaimWindowHours, setRewardClaimWindowHours] = useState("24");
  const [isCreatingReward, setIsCreatingReward] = useState(false);
  const [createRewardError, setCreateRewardError] = useState<string | null>(null);
  const [createRewardConfirmed, setCreateRewardConfirmed] = useState(false);
  const [togglingRewardId, setTogglingRewardId] = useState<number | null>(null);
  const [drawingRewardId, setDrawingRewardId] = useState<number | null>(null);
  const [rewardActionError, setRewardActionError] = useState<string | null>(null);
  const [redeemCodeInput, setRedeemCodeInput] = useState("");
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateConfirmed, setValidateConfirmed] = useState(false);
  const [groupOrderTitle, setGroupOrderTitle] = useState("");
  const [groupOrderGoalSoles, setGroupOrderGoalSoles] = useState("500");
  const [groupOrderPledgeDays, setGroupOrderPledgeDays] = useState("7");
  const [groupOrderWithdrawDays, setGroupOrderWithdrawDays] = useState("7");
  const [isCreatingGroupOrder, setIsCreatingGroupOrder] = useState(false);
  const [createGroupOrderError, setCreateGroupOrderError] = useState<string | null>(null);
  const [createGroupOrderConfirmed, setCreateGroupOrderConfirmed] = useState(false);
  const [pledgeSolesByOrder, setPledgeSolesByOrder] = useState<Record<number, string>>({});
  const [pledgingOrderId, setPledgingOrderId] = useState<number | null>(null);
  const [withdrawingOrderId, setWithdrawingOrderId] = useState<number | null>(null);
  const [refundingOrderId, setRefundingOrderId] = useState<number | null>(null);
  const [groupOrderActionError, setGroupOrderActionError] = useState<string | null>(null);
  const [certificateThreshold, setCertificateThreshold] = useState("700");
  const [isGeneratingCertificate, setIsGeneratingCertificate] = useState(false);
  const [certificateStep, setCertificateStep] = useState<string | null>(null);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [certificateConfirmed, setCertificateConfirmed] = useState(false);
  const [borrowAmountSoles, setBorrowAmountSoles] = useState("100");
  const [isBorrowing, setIsBorrowing] = useState(false);
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [repayingLoanId, setRepayingLoanId] = useState<number | null>(null);
  const [loanActionError, setLoanActionError] = useState<string | null>(null);
  const [beneficiaryCodeInput, setBeneficiaryCodeInput] = useState("");
  const [beneficiaryAddress, setBeneficiaryAddress] = useState<Address | undefined>(undefined);
  const [isResolvingBeneficiary, setIsResolvingBeneficiary] = useState(false);
  const [beneficiaryNotFound, setBeneficiaryNotFound] = useState(false);
  const [issueAmountSoles, setIssueAmountSoles] = useState("50");
  const [issueDurationDays, setIssueDurationDays] = useState("30");
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueConfirmed, setIssueConfirmed] = useState(false);

  const { formatSoles, solesToEth } = useExchangeRate();

  const [myLat, setMyLat] = useState<number | null>(null);
  const [myLng, setMyLng] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [bodegaLocationsByAddress, setBodegaLocationsByAddress] = useState<Record<string, { lat: number; lng: number }>>(
    {},
  );
  const [groupOrderRadiusKm, setGroupOrderRadiusKm] = useState<number | "all">(2);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/bodega/location?address=${address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.location) {
          setMyLat(data.location.lat);
          setMyLng(data.location.lng);
        }
      })
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    fetch("/api/bodega/location")
      .then((res) => res.json())
      .then((data) => {
        const byAddress: Record<string, { lat: number; lng: number }> = {};
        for (const loc of data.locations ?? []) byAddress[(loc.address as string).toLowerCase()] = { lat: loc.lat, lng: loc.lng };
        setBodegaLocationsByAddress(byAddress);
      })
      .catch(() => {});
  }, []);

  function handleLocateMe() {
    if (!navigator.geolocation) {
      setLocationError("Tu navegador no soporta geolocalización.");
      return;
    }
    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLat(position.coords.latitude);
        setMyLng(position.coords.longitude);
        setIsLocating(false);
      },
      () => {
        setLocationError("No pudimos acceder a tu ubicación. Revisa los permisos del navegador.");
        setIsLocating(false);
      },
    );
  }

  async function handleSaveLocation() {
    if (!address || myLat === null || myLng === null) return;
    setIsSavingLocation(true);
    setLocationError(null);
    setLocationSaved(false);
    try {
      const res = await fetch("/api/bodega/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, lat: myLat, lng: myLng }),
      });
      if (!res.ok) throw new Error("failed");
      setLocationSaved(true);
    } catch {
      setLocationError("No se pudo guardar tu ubicación. Intenta de nuevo.");
    } finally {
      setIsSavingLocation(false);
    }
  }

  useEffect(() => {
    if (!address) return;
    fetch("/api/bodega/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json())
      .then((data) => setBodegaCode(data.code ?? null))
      .catch(() => setBodegaCode(null));
  }, [address]);

  const contractsConfigured = Boolean(fiadoScoringAddress && paymentRouterAddress);

  const fiadoEnabledQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "isFiadoEnabled",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });
  const fiadoEnabled = fiadoEnabledQuery.data === true;

  const scoreQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getScore",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const limitQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getCreditLimit",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const aiInfoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAiAdjustmentInfo",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const historyQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getPaymentHistory",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const totalOutstandingQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getTotalOutstanding",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const availableFiadoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAvailableFiado",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fiadoScoringAddress) },
  });

  const invoiceCountQuery = useReadContract({
    address: invoiceEscrowAddress,
    abi: invoiceEscrowAbi,
    functionName: "nextInvoiceId",
    query: { enabled: Boolean(invoiceEscrowAddress) },
  });
  const invoiceCount = Number((invoiceCountQuery.data as bigint | undefined) ?? BigInt(0));

  const invoicesQuery = useReadContracts({
    contracts: Array.from({ length: invoiceCount }, (_, i) => ({
      address: invoiceEscrowAddress,
      abi: invoiceEscrowAbi,
      functionName: "invoices",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(invoiceEscrowAddress) && invoiceCount > 0 },
  });

  const INVOICE_STATUS_LABEL = ["Propuesta", "Activa", "Pagada", "Vencida — reclamada", "Cancelada"];
  const myInvoices = (invoicesQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [invBodega, invCustomer, principal, collateral, repaidAmount, dueDate, status] = result.result as [
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        number,
      ];
      return { id: i, bodega: invBodega, customer: invCustomer, principal, collateral, repaidAmount, dueDate, status };
    })
    .filter((inv): inv is NonNullable<typeof inv> => inv !== null)
    .filter((inv) => address && inv.bodega.toLowerCase() === (address as string).toLowerCase())
    .reverse();

  async function handleProposeInvoice() {
    if (!customerAddress || !invoiceEscrowAddress || !smartAccountClient || !address) return;
    setIsProposing(true);
    setProposeError(null);
    setProposeConfirmed(false);
    try {
      const principalWei = parseEther(solesToEth(Number(escrowPrincipalSoles || "0")).toFixed(18));
      const collateralWei = parseEther(solesToEth(Number(escrowCollateralSoles || "0")).toFixed(18));
      const dueDate = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(Number(escrowDueDays || "0"))) * 86400);
      await sendAndWait(smartAccountClient, address, [
        {
          address: invoiceEscrowAddress,
          abi: invoiceEscrowAbi,
          functionName: "proposeInvoice",
          args: [customerAddress, principalWei, collateralWei, dueDate],
        },
      ]);
      setProposeConfirmed(true);
      invoiceCountQuery.refetch();
      invoicesQuery.refetch();
    } catch {
      setProposeError("No se pudo proponer el fiado con garantía. Intenta de nuevo.");
    } finally {
      setIsProposing(false);
    }
  }

  async function handleClaimCollateral(id: number) {
    if (!invoiceEscrowAddress || !smartAccountClient || !address) return;
    setClaimingInvoiceId(id);
    setClaimError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: invoiceEscrowAddress, abi: invoiceEscrowAbi, functionName: "claimCollateral", args: [BigInt(id)] },
      ]);
      invoicesQuery.refetch();
      refetchAll();
    } catch {
      setClaimError("No se pudo reclamar la garantía. Revisa que ya haya vencido el plazo.");
    } finally {
      setClaimingInvoiceId(null);
    }
  }

  const rewardCountQuery = useReadContract({
    address: rewardsCatalogAddress,
    abi: rewardsCatalogAbi,
    functionName: "nextRewardId",
    query: { enabled: Boolean(rewardsCatalogAddress) },
  });
  const rewardCount = Number((rewardCountQuery.data as bigint | undefined) ?? BigInt(0));

  const rewardsQuery = useReadContracts({
    contracts: Array.from({ length: rewardCount }, (_, i) => ({
      address: rewardsCatalogAddress,
      abi: rewardsCatalogAbi,
      functionName: "rewards",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(rewardsCatalogAddress) && rewardCount > 0 },
  });

  const REWARD_KIND_LABEL = ["Instantáneo", "Sorteo"];
  const myRewards = (rewardsQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [rBodega, title, kind, pointCost, availableUntil, claimWindowSeconds, active, drawn, winner] = result.result as [
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
      return { id: i, bodega: rBodega, title, kind, pointCost, availableUntil, claimWindowSeconds, active, drawn, winner };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => address && r.bodega.toLowerCase() === (address as string).toLowerCase())
    .reverse();

  async function handleCreateReward() {
    if (!rewardsCatalogAddress || !smartAccountClient || !address || !rewardTitle.trim()) return;
    setIsCreatingReward(true);
    setCreateRewardError(null);
    setCreateRewardConfirmed(false);
    try {
      const pointCostWei = parseEther(rewardCostPuntos || "0");
      const availableUntil = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(Number(rewardAvailableDays || "0"))) * 86400);
      const claimWindowSeconds = BigInt(Math.max(1, Math.round(Number(rewardClaimWindowHours || "0"))) * 3600);
      await sendAndWait(smartAccountClient, address, [
        {
          address: rewardsCatalogAddress,
          abi: rewardsCatalogAbi,
          functionName: "createReward",
          args: [rewardTitle.trim(), rewardKind === "Instant" ? 0 : 1, pointCostWei, availableUntil, claimWindowSeconds],
        },
      ]);
      setCreateRewardConfirmed(true);
      setRewardTitle("");
      rewardCountQuery.refetch();
      rewardsQuery.refetch();
    } catch {
      setCreateRewardError("No se pudo crear el beneficio. Intenta de nuevo.");
    } finally {
      setIsCreatingReward(false);
    }
  }

  async function handleToggleRewardActive(id: number, currentActive: boolean) {
    if (!rewardsCatalogAddress || !smartAccountClient || !address) return;
    setTogglingRewardId(id);
    setRewardActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: rewardsCatalogAddress, abi: rewardsCatalogAbi, functionName: "setRewardActive", args: [BigInt(id), !currentActive] },
      ]);
      rewardsQuery.refetch();
    } catch {
      setRewardActionError("No se pudo actualizar el beneficio. Intenta de nuevo.");
    } finally {
      setTogglingRewardId(null);
    }
  }

  async function handleDrawWinner(id: number) {
    if (!rewardsCatalogAddress || !smartAccountClient || !address) return;
    setDrawingRewardId(id);
    setRewardActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: rewardsCatalogAddress, abi: rewardsCatalogAbi, functionName: "drawWinner", args: [BigInt(id)] },
      ]);
      rewardsQuery.refetch();
    } catch {
      setRewardActionError("No se pudo sortear todavía. Revisa que ya haya pasado la fecha límite y que haya participantes.");
    } finally {
      setDrawingRewardId(null);
    }
  }

  async function handleValidateCode() {
    if (!rewardsCatalogAddress || !smartAccountClient || !address || !redeemCodeInput.trim()) return;
    setIsValidatingCode(true);
    setValidateError(null);
    setValidateConfirmed(false);
    try {
      await sendAndWait(smartAccountClient, address, [
        {
          address: rewardsCatalogAddress,
          abi: rewardsCatalogAbi,
          functionName: "fulfillRedemption",
          args: [BigInt(redeemCodeInput.trim())],
        },
      ]);
      setValidateConfirmed(true);
      setRedeemCodeInput("");
    } catch {
      setValidateError("Código inválido, vencido, o ya entregado.");
    } finally {
      setIsValidatingCode(false);
    }
  }

  const groupOrderCountQuery = useReadContract({
    address: groupOrdersAddress,
    abi: groupOrdersAbi,
    functionName: "nextGroupOrderId",
    query: { enabled: Boolean(groupOrdersAddress) },
  });
  const groupOrderCount = Number((groupOrderCountQuery.data as bigint | undefined) ?? BigInt(0));

  const groupOrdersQuery = useReadContracts({
    contracts: Array.from({ length: groupOrderCount }, (_, i) => ({
      address: groupOrdersAddress,
      abi: groupOrdersAbi,
      functionName: "groupOrders",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(groupOrdersAddress) && groupOrderCount > 0 },
  });

  const myPledgesQuery = useReadContracts({
    contracts: Array.from({ length: groupOrderCount }, (_, i) => ({
      address: groupOrdersAddress,
      abi: groupOrdersAbi,
      functionName: "pledges",
      args: [BigInt(i), address ?? "0x0000000000000000000000000000000000000000"],
    })),
    query: { enabled: Boolean(groupOrdersAddress) && groupOrderCount > 0 && Boolean(address) },
  });

  const allGroupOrders = (groupOrdersQuery.data ?? [])
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
      const myPledge = (myPledgesQuery.data?.[i]?.status === "success" ? (myPledgesQuery.data[i].result as bigint) : BigInt(0)) ?? BigInt(0);
      const organizerLocation = bodegaLocationsByAddress[organizer.toLowerCase()];
      const distanceFromMeKm =
        myLat !== null && myLng !== null && organizerLocation
          ? distanceKm(myLat, myLng, organizerLocation.lat, organizerLocation.lng)
          : null;
      return { id: i, organizer, title, goal, pledged, pledgeDeadline, withdrawWindowSeconds, withdrawn, myPledge, distanceFromMeKm };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .reverse();

  // Pedidos de bodegas lejanas no tienen sentido: alguien tiene que ir a recoger la mercadería
  // a un solo punto de entrega. Si no sé dónde estoy, no puedo filtrar por distancia — se
  // muestra todo, con un aviso para que guarde su ubicación. Los pedidos cuya organizadora no
  // guardó ubicación quedan aparte, nunca mezclados silenciosamente en la lista "cercana".
  const nearbyGroupOrders =
    myLat === null || myLng === null || groupOrderRadiusKm === "all"
      ? allGroupOrders
      : allGroupOrders.filter((o) => o.distanceFromMeKm !== null && o.distanceFromMeKm <= groupOrderRadiusKm);
  const groupOrdersWithoutLocation =
    myLat === null || myLng === null || groupOrderRadiusKm === "all"
      ? []
      : allGroupOrders.filter((o) => o.distanceFromMeKm === null);

  async function handleCreateGroupOrder() {
    if (!groupOrdersAddress || !smartAccountClient || !address || !groupOrderTitle.trim()) return;
    setIsCreatingGroupOrder(true);
    setCreateGroupOrderError(null);
    setCreateGroupOrderConfirmed(false);
    try {
      const goalWei = parseEther(solesToEth(Number(groupOrderGoalSoles || "0")).toFixed(18));
      const pledgeDeadline = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(Number(groupOrderPledgeDays || "0"))) * 86400);
      const withdrawWindowSeconds = BigInt(Math.max(1, Math.round(Number(groupOrderWithdrawDays || "0"))) * 86400);
      await sendAndWait(smartAccountClient, address, [
        {
          address: groupOrdersAddress,
          abi: groupOrdersAbi,
          functionName: "createGroupOrder",
          args: [groupOrderTitle.trim(), goalWei, pledgeDeadline, withdrawWindowSeconds],
        },
      ]);
      setCreateGroupOrderConfirmed(true);
      setGroupOrderTitle("");
      groupOrderCountQuery.refetch();
      groupOrdersQuery.refetch();
    } catch {
      setCreateGroupOrderError("No se pudo crear el pedido grupal. Intenta de nuevo.");
    } finally {
      setIsCreatingGroupOrder(false);
    }
  }

  async function handlePledge(id: number) {
    if (!groupOrdersAddress || !smartAccountClient || !address) return;
    setPledgingOrderId(id);
    setGroupOrderActionError(null);
    try {
      const amountWei = parseEther(solesToEth(Number(pledgeSolesByOrder[id] || "0")).toFixed(18));
      await sendAndWait(smartAccountClient, address, [
        { address: groupOrdersAddress, abi: groupOrdersAbi, functionName: "pledge", args: [BigInt(id)], value: amountWei },
      ]);
      setPledgeSolesByOrder((prev) => ({ ...prev, [id]: "" }));
      groupOrdersQuery.refetch();
      myPledgesQuery.refetch();
    } catch {
      setGroupOrderActionError("No se pudo aportar. Revisa que el pedido siga abierto.");
    } finally {
      setPledgingOrderId(null);
    }
  }

  async function handleWithdrawGroupOrder(id: number) {
    if (!groupOrdersAddress || !smartAccountClient || !address) return;
    setWithdrawingOrderId(id);
    setGroupOrderActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: groupOrdersAddress, abi: groupOrdersAbi, functionName: "withdraw", args: [BigInt(id)] },
      ]);
      groupOrdersQuery.refetch();
    } catch {
      setGroupOrderActionError("No se pudo retirar. Revisa que ya se haya alcanzado la meta y que el plazo siga vigente.");
    } finally {
      setWithdrawingOrderId(null);
    }
  }

  async function handleRefundGroupOrder(id: number) {
    if (!groupOrdersAddress || !smartAccountClient || !address) return;
    setRefundingOrderId(id);
    setGroupOrderActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: groupOrdersAddress, abi: groupOrdersAbi, functionName: "refund", args: [BigInt(id)] },
      ]);
      groupOrdersQuery.refetch();
      myPledgesQuery.refetch();
    } catch {
      setGroupOrderActionError("Todavía no se puede reembolsar este pedido.");
    } finally {
      setRefundingOrderId(null);
    }
  }

  const certifiedThresholdQuery = useReadContract({
    address: creditCertificateAddress,
    abi: creditCertificateAbi,
    functionName: "getCertifiedThreshold",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && creditCertificateAddress) },
  });
  const certifiedThreshold = Number((certifiedThresholdQuery.data as bigint | undefined) ?? BigInt(0));

  const interestBpsQuery = useReadContract({
    address: creditLineAddress,
    abi: creditLineAbi,
    functionName: "INTEREST_BPS",
    query: { enabled: Boolean(creditLineAddress) },
  });
  const interestBps = Number((interestBpsQuery.data as bigint | undefined) ?? BigInt(500));

  const tiersQuery = useReadContracts({
    contracts: [0, 1, 2].map((i) => ({
      address: creditLineAddress,
      abi: creditLineAbi,
      functionName: "tiers",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(creditLineAddress) },
  });
  const tiers = (tiersQuery.data ?? [])
    .map((r) => (r.status === "success" ? (r.result as [bigint, bigint]) : null))
    .filter((t): t is [bigint, bigint] => t !== null)
    .map(([minThreshold, collateralBps]) => ({ minThreshold: Number(minThreshold), collateralBps: Number(collateralBps) }));
  const myTierCollateralBps = tiers.find((t) => certifiedThreshold >= t.minThreshold)?.collateralBps ?? null;

  const loanCountQuery = useReadContract({
    address: creditLineAddress,
    abi: creditLineAbi,
    functionName: "nextLoanId",
    query: { enabled: Boolean(creditLineAddress) },
  });
  const loanCount = Number((loanCountQuery.data as bigint | undefined) ?? BigInt(0));

  const loansQuery = useReadContracts({
    contracts: Array.from({ length: loanCount }, (_, i) => ({
      address: creditLineAddress,
      abi: creditLineAbi,
      functionName: "loans",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(creditLineAddress) && loanCount > 0 },
  });
  const myLoans = (loansQuery.data ?? [])
    .map((r, i) => {
      if (r.status !== "success") return null;
      const [loanBodega, principal, collateral, loanInterestBps, dueDate, resolved] = r.result as [Address, bigint, bigint, bigint, bigint, boolean];
      return { id: i, bodega: loanBodega, principal, collateral, interestBps: loanInterestBps, dueDate, resolved };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .filter((l) => address && l.bodega.toLowerCase() === (address as string).toLowerCase() && !l.resolved)
    .reverse();

  async function handleGenerateCertificate() {
    if (!creditCertificateAddress || !smartAccountClient || !address) return;
    setIsGeneratingCertificate(true);
    setCertificateError(null);
    setCertificateConfirmed(false);
    try {
      setCertificateStep("Consultando tu score...");
      const attestRes = await fetch("/api/credit-certificate/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodegaAddress: address, threshold: Number(certificateThreshold) }),
      });
      const attestation = await attestRes.json();
      if (!attestRes.ok) throw new Error(attestation.error ?? "No se pudo verificar tu historial.");

      setCertificateStep("Generando tu certificado (puede tardar unos segundos)...");
      const proveRes = await fetch("/api/credit-certificate/prove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodegaAddress: address,
          threshold: certificateThreshold,
          score: attestation.score,
          issuedAt: attestation.issuedAt,
          R8x: attestation.R8x,
          R8y: attestation.R8y,
          S: attestation.S,
          oracleAx: attestation.oraclePubKey.ax,
          oracleAy: attestation.oraclePubKey.ay,
        }),
      });
      const proof = await proveRes.json();
      if (!proveRes.ok) throw new Error(proof.error ?? "No se pudo generar el certificado.");

      setCertificateStep("Enviando tu certificado...");
      const a = (proof.a as string[]).map((x) => BigInt(x));
      const b = (proof.b as string[][]).map((row) => row.map((x) => BigInt(x)));
      const c = (proof.c as string[]).map((x) => BigInt(x));
      const publicSignals = (proof.publicSignals as string[]).map((x) => BigInt(x));

      await sendAndWait(smartAccountClient, address, [
        { address: creditCertificateAddress, abi: creditCertificateAbi, functionName: "submitCertificate", args: [a, b, c, publicSignals] },
      ]);
      setCertificateConfirmed(true);
      certifiedThresholdQuery.refetch();
    } catch (err) {
      setCertificateError(err instanceof Error ? err.message : "No se pudo generar el certificado.");
    } finally {
      setCertificateStep(null);
      setIsGeneratingCertificate(false);
    }
  }

  async function handleBorrow() {
    if (!creditLineAddress || !smartAccountClient || !address || myTierCollateralBps === null) return;
    setIsBorrowing(true);
    setBorrowError(null);
    try {
      const amountWei = parseEther(solesToEth(Number(borrowAmountSoles || "0")).toFixed(18));
      const collateralWei = (amountWei * BigInt(myTierCollateralBps)) / BigInt(10_000);
      await sendAndWait(smartAccountClient, address, [
        { address: creditLineAddress, abi: creditLineAbi, functionName: "borrow", args: [amountWei], value: collateralWei },
      ]);
      loanCountQuery.refetch();
      loansQuery.refetch();
    } catch {
      setBorrowError("No se pudo pedir el préstamo. Revisa que el fondo tenga suficiente disponible.");
    } finally {
      setIsBorrowing(false);
    }
  }

  async function handleRepayLoan(loanId: number, principal: bigint) {
    if (!creditLineAddress || !smartAccountClient || !address) return;
    setRepayingLoanId(loanId);
    setLoanActionError(null);
    try {
      const owed = principal + (principal * BigInt(interestBps)) / BigInt(10_000);
      await sendAndWait(smartAccountClient, address, [
        { address: creditLineAddress, abi: creditLineAbi, functionName: "repay", args: [BigInt(loanId)], value: owed },
      ]);
      loansQuery.refetch();
    } catch {
      setLoanActionError("No se pudo pagar el préstamo. Intenta de nuevo.");
    } finally {
      setRepayingLoanId(null);
    }
  }

  const beneficioOwnerQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "owner",
    query: { enabled: Boolean(beneficioTokenAddress) },
  });
  const isBeneficioAdmin =
    Boolean(address) &&
    Boolean(beneficioOwnerQuery.data) &&
    (beneficioOwnerQuery.data as string).toLowerCase() === (address as string).toLowerCase();

  const bodegaRegistryQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "bodegaRegistry",
    query: { enabled: Boolean(beneficioTokenAddress) },
  });
  const registryOutOfSync =
    Boolean(bodegaRegistryQuery.data) &&
    Boolean(paymentRouterAddress) &&
    (bodegaRegistryQuery.data as string).toLowerCase() !== (paymentRouterAddress as string).toLowerCase();
  const [isSyncingRegistry, setIsSyncingRegistry] = useState(false);
  const [syncRegistryError, setSyncRegistryError] = useState<string | null>(null);
  const [syncRegistryConfirmed, setSyncRegistryConfirmed] = useState(false);

  async function handleSyncRegistry() {
    if (!beneficioTokenAddress || !paymentRouterAddress || !smartAccountClient || !address) return;
    setIsSyncingRegistry(true);
    setSyncRegistryError(null);
    setSyncRegistryConfirmed(false);
    try {
      await sendAndWait(smartAccountClient, address, [
        {
          address: beneficioTokenAddress,
          abi: beneficioTokenAbi,
          functionName: "setBodegaRegistry",
          args: [paymentRouterAddress],
        },
      ]);
      setSyncRegistryConfirmed(true);
      bodegaRegistryQuery.refetch();
    } catch {
      setSyncRegistryError("No se pudo actualizar. Intenta de nuevo.");
    } finally {
      setIsSyncingRegistry(false);
    }
  }

  const refetchAll = () => {
    fiadoEnabledQuery.refetch();
    scoreQuery.refetch();
    limitQuery.refetch();
    aiInfoQuery.refetch();
    historyQuery.refetch();
    totalOutstandingQuery.refetch();
    availableFiadoQuery.refetch();
  };

  const isValidCustomerCodeFormat = /^\d{6}$/.test(customerCodeInput.trim());

  useEffect(() => {
    if (!isValidCustomerCodeFormat) return;
    const code = customerCodeInput.trim();
    let cancelled = false;

    async function resolve() {
      setIsResolvingCustomer(true);
      setCustomerNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.address) {
          setCustomerAddress(data.address as Address);
        } else {
          setCustomerAddress(undefined);
          setCustomerNotFound(true);
        }
      } catch {
        if (!cancelled) {
          setCustomerAddress(undefined);
          setCustomerNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolvingCustomer(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [customerCodeInput, isValidCustomerCodeFormat]);

  function handleCustomerCodeChange(value: string) {
    const trimmed = value.trim();
    setCustomerCodeInput(trimmed);
    if (!/^\d{6}$/.test(trimmed)) {
      setCustomerAddress(undefined);
      setCustomerNotFound(false);
    }
  }

  const isValidBeneficiaryCodeFormat = /^\d{6}$/.test(beneficiaryCodeInput.trim());

  useEffect(() => {
    if (!isValidBeneficiaryCodeFormat) return;
    const code = beneficiaryCodeInput.trim();
    let cancelled = false;

    async function resolve() {
      setIsResolvingBeneficiary(true);
      setBeneficiaryNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.address) {
          setBeneficiaryAddress(data.address as Address);
        } else {
          setBeneficiaryAddress(undefined);
          setBeneficiaryNotFound(true);
        }
      } catch {
        if (!cancelled) {
          setBeneficiaryAddress(undefined);
          setBeneficiaryNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolvingBeneficiary(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [beneficiaryCodeInput, isValidBeneficiaryCodeFormat]);

  function handleBeneficiaryCodeChange(value: string) {
    const trimmed = value.trim();
    setBeneficiaryCodeInput(trimmed);
    if (!/^\d{6}$/.test(trimmed)) {
      setBeneficiaryAddress(undefined);
      setBeneficiaryNotFound(false);
    }
  }

  async function handleIssue() {
    if (!beneficiaryAddress || !beneficioTokenAddress || !smartAccountClient || !address) return;
    setIsIssuing(true);
    setIssueError(null);
    setIssueConfirmed(false);
    try {
      const amountWei = parseEther((issueAmountSoles || "0").trim() || "0");
      const durationDays = Math.max(1, Math.round(Number(issueDurationDays || "0")));
      await sendAndWait(smartAccountClient, address, [
        {
          address: beneficioTokenAddress,
          abi: beneficioTokenAbi,
          functionName: "issue",
          args: [beneficiaryAddress, amountWei, BigInt(durationDays * 86400)],
        },
      ]);
      setIssueConfirmed(true);
      setBeneficiaryCodeInput("");
      setBeneficiaryAddress(undefined);
    } catch {
      setIssueError("No se pudo emitir el beneficio. Intenta de nuevo.");
    } finally {
      setIsIssuing(false);
    }
  }

  async function handleFiar() {
    if (!customerAddress || !fiadoScoringAddress || !smartAccountClient || !address) return;
    setIsFiarSubmitting(true);
    setFiarError(null);
    setFiarConfirmed(false);
    try {
      const ethAmount = solesToEth(Number(fiarAmountSoles || "0"));
      await sendAndWait(smartAccountClient, address, [
        {
          address: fiadoScoringAddress,
          abi: fiadoScoringAbi,
          functionName: "extendFiado",
          args: [customerAddress, parseEther(ethAmount.toFixed(18))],
        },
      ]);
      setFiarConfirmed(true);
      setCustomerCodeInput("");
      setCustomerAddress(undefined);
      refetchAll();
    } catch {
      setFiarError("No se pudo registrar el fiado. Revisa que tengas espacio disponible para fiar esa cantidad.");
    } finally {
      setIsFiarSubmitting(false);
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!fiadoScoringAddress || !smartAccountClient || !address) return;
    setIsTogglePending(true);
    setToggleError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: fiadoScoringAddress, abi: fiadoScoringAbi, functionName: "setFiadoEnabled", args: [enabled] },
      ]);
      refetchAll();
    } catch {
      setToggleError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setIsTogglePending(false);
    }
  }

  async function handleAskAi() {
    if (!address) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch("/api/fiado-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodegaAddress: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Algo falló al calcular tu fiado");
      setAiResult(data);
      refetchAll();
    } catch {
      setAiError("No pudimos calcular tu fiado ahora mismo. Intenta de nuevo en un momento.");
    } finally {
      setIsAiLoading(false);
    }
  }

  async function handleCopy() {
    if (!bodegaCode) return;
    await navigator.clipboard.writeText(bodegaCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    if (!address) return;
    fetch(`/api/telegram/status?bodegaAddress=${address}`)
      .then((res) => res.json())
      .then((data) => setTelegramLinked(Boolean(data.linked)))
      .catch(() => setTelegramLinked(null));
  }, [address]);

  async function handleGenerateCode() {
    if (!address) return;
    setIsGeneratingCode(true);
    setTelegramMessage(null);
    try {
      const res = await fetch("/api/telegram/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      setLinkCode(data.code ?? null);
    } catch {
      setTelegramMessage("No pudimos generar el código. Intenta de nuevo.");
    } finally {
      setIsGeneratingCode(false);
    }
  }

  async function handleCheckLinked() {
    if (!address) return;
    setIsLinkingTelegram(true);
    setTelegramMessage(null);
    try {
      const res = await fetch(`/api/telegram/status?bodegaAddress=${address}`);
      const data = await res.json();
      setTelegramLinked(Boolean(data.linked));
      setTelegramMessage(
        data.linked
          ? "¡Listo! Vinculado."
          : "Todavía no te veo vinculado. Manda el mensaje al bot y volvé a intentar.",
      );
    } catch {
      setTelegramMessage("No pudimos revisar. Intenta de nuevo.");
    } finally {
      setIsLinkingTelegram(false);
    }
  }

  async function handleTestNotify() {
    if (!address) return;
    setTelegramMessage(null);
    try {
      const res = await fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodegaAddress: address,
          text: "🔔 Notificaciones de Bodegueando activadas. Acá vas a ver tus pagos.",
        }),
      });
      const data = await res.json();
      setTelegramMessage(data.sent ? "Mensaje de prueba enviado ✓" : "No se pudo enviar. Revisa la vinculación.");
    } catch {
      setTelegramMessage("No se pudo enviar. Intenta de nuevo.");
    }
  }

  if (!address) {
    return (
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
        {isAccountLoading ? "Preparando tu cuenta…" : "Ingresa arriba para ver tu bodega."}
      </p>
    );
  }

  if (!contractsConfigured) {
    return (
      <p className="max-w-md text-center text-sm text-[#6b6d64]">
        La app todavía no está conectada a los contratos. Avísale a soporte.
      </p>
    );
  }

  const score = Number((scoreQuery.data as bigint | undefined) ?? BigInt(0));
  const limitEth = Number((limitQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18;
  const aiAdjusted = Boolean((aiInfoQuery.data as [boolean, bigint] | undefined)?.[0]);
  const confianza = confianzaLabel(score);

  const [paymentAmounts, paymentTimestamps] = (historyQuery.data as [bigint[], bigint[]] | undefined) ?? [[], []];
  const payments = paymentAmounts
    .map((amount, i) => ({ amountEth: Number(amount) / 1e18, timestamp: Number(paymentTimestamps[i] ?? BigInt(0)) }))
    .sort((a, b) => b.timestamp - a.timestamp);
  const totalReceivedEth = payments.reduce((sum, p) => sum + p.amountEth, 0);

  return (
    <div className="flex w-full max-w-md flex-col gap-8 text-left">
      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Tu código para cobrar</h2>
        <p className="text-xs text-[#6b6d64]">Que tus clientes escaneen este código para pagarte.</p>
        {bodegaCode ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl border border-black/10 bg-white p-3">
              <QRCodeSVG
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/pagar/${bodegaCode}`}
                size={180}
              />
            </div>
            <p className="text-xs text-[#6b6d64]">O si no se puede escanear, este código:</p>
            <div className="flex items-center gap-2">
              <code className="rounded-lg bg-black/[0.05] px-3 py-2 text-lg font-semibold tracking-widest text-[#0a0a0b]">
                {bodegaCode}
              </code>
              <button onClick={handleCopy} className={outlineButtonClass}>
                {copied ? "¡Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#6b6d64]">Generando tu código…</p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Tu ubicación en el mapa</h2>
        <p className="text-xs text-[#6b6d64]">
          Para que los clientes te encuentren en &quot;Bodegas cercanas&quot;. Arrastra el pin
          para ajustarlo si no cae exacto.
        </p>
        <div className="h-[260px] w-full overflow-hidden rounded-xl border border-black/10">
          <Map key={`${myLat ?? "default"}-${myLng ?? "default"}`} center={[myLng ?? -77.0428, myLat ?? -12.0464]} zoom={myLat !== null ? 15 : 11}>
            {myLat !== null && myLng !== null && (
              <MapMarker
                longitude={myLng}
                latitude={myLat}
                draggable
                onDragEnd={({ lng, lat }) => {
                  setMyLng(lng);
                  setMyLat(lat);
                }}
              >
                <MarkerContent />
              </MapMarker>
            )}
          </Map>
        </div>
        <div className="flex gap-2">
          <button onClick={handleLocateMe} disabled={isLocating} className={outlineButtonClass}>
            {isLocating ? "Ubicando..." : "Usar mi ubicación actual"}
          </button>
          <button
            onClick={handleSaveLocation}
            disabled={isSavingLocation || myLat === null || myLng === null}
            className={primaryButtonClass}
            style={primaryButtonStyle}
          >
            {isSavingLocation ? "Guardando..." : "Guardar ubicación"}
          </button>
        </div>
        {locationError && <p className="text-xs text-red-500">{locationError}</p>}
        {locationSaved && <p className="text-xs text-green-600">¡Listo! Ya apareces en el mapa ✓</p>}
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Tus ventas</h2>
        {historyQuery.isLoading ? (
          <p className="text-xs text-[#6b6d64]">Cargando tu historial…</p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-[#6b6d64]">Todavía no tienes ventas registradas.</p>
        ) : (
          <>
            <div className={highlightBoxClass}>
              <p className="text-xs text-[#6b6d64]">Total recibido (últimos {payments.length} pagos)</p>
              <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                {formatSoles(totalReceivedEth)}
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/10">
              {payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 bg-white px-3 py-2 text-sm">
                  <span className="text-[#6b6d64]">{formatPaymentDate(p.timestamp)}</span>
                  <span className="font-medium text-[#0a0a0b]">{formatSoles(p.amountEth)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[#6b6d64]">
              Se muestran los últimos 12 pagos — es el historial que guarda el contrato para calcular tu fiado.
            </p>
          </>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Fiado para tus clientes</h2>
        <p className="text-xs text-[#6b6d64]">
          Tú decides si le fías a tus clientes. Puedes prenderlo o apagarlo cuando quieras.
        </p>
        <button
          onClick={() => handleToggle(!fiadoEnabled)}
          disabled={isTogglePending || fiadoEnabledQuery.isLoading}
          className={primaryButtonClass}
          style={primaryButtonStyle}
        >
          {isTogglePending
            ? "Guardando..."
            : fiadoEnabled
              ? "Fiado activado — desactivar"
              : "Activar fiado para mis clientes"}
        </button>
        {toggleError && <p className="text-xs text-red-500">{toggleError}</p>}

        {fiadoEnabled && (
          <div className="flex flex-col gap-3">
            <div className={highlightBoxClass}>
              <p className="text-xs text-[#6b6d64]">Fiado que le ofreces a cada cliente ahora mismo</p>
              <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                {limitQuery.isLoading ? "…" : formatSoles(limitEth)}
              </p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="text-[#6b6d64]">Confianza:</span>
                <span className={`font-medium ${confianza.color}`}>
                  {scoreQuery.isLoading ? "…" : confianza.text}
                </span>
                <span className="text-xs text-[#6b6d64]">
                  ({scoreQuery.isLoading ? "…" : score}/1000{aiAdjusted ? ", ajustado por IA" : ""})
                </span>
              </div>
            </div>

            <button onClick={handleAskAi} disabled={isAiLoading} className={outlineButtonClass}>
              {isAiLoading ? "Calculando..." : "Actualizar con IA"}
            </button>
            {aiError && <p className="text-xs text-red-500">{aiError}</p>}
            {aiResult && (
              <div className={`${highlightBoxClass} text-sm`}>
                <p className="text-[#0a0a0b]">
                  Nuevo límite:{" "}
                  <span className="font-medium">
                    {formatSoles(Number(aiResult.recommendation.creditLimitWei) / 1e18)}
                  </span>{" "}
                  · Riesgo:{" "}
                  <span className={`font-medium ${RISK_COLOR[aiResult.recommendation.riskLevel]}`}>
                    {RISK_LABEL[aiResult.recommendation.riskLevel]}
                  </span>
                </p>
                <p className="mt-1 text-[#55564f]">{aiResult.recommendation.rationale}</p>
                {aiResult.txHash && (
                  <a
                    href={`https://sepolia.arbiscan.io/tx/${aiResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-[#6b6d64] underline"
                  >
                    Ver comprobante ↗
                  </a>
                )}
              </div>
            )}

            <div className={highlightBoxClass}>
              <p className="text-xs text-[#6b6d64]">Fiado que ya diste (pendiente de cobro)</p>
              <p className="text-lg font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                {totalOutstandingQuery.isLoading
                  ? "…"
                  : formatSoles(Number((totalOutstandingQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18)}
              </p>
              <p className="mt-1 text-xs text-[#6b6d64]">
                Espacio disponible para fiar más:{" "}
                {availableFiadoQuery.isLoading
                  ? "…"
                  : formatSoles(Number((availableFiadoQuery.data as bigint | undefined) ?? BigInt(0)) / 1e18)}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="customerCode" className="text-sm font-medium text-[#0a0a0b]">
                Fiar a un cliente
              </label>
              <input
                id="customerCode"
                inputMode="numeric"
                value={customerCodeInput}
                onChange={(e) => handleCustomerCodeChange(e.target.value)}
                placeholder="El código de 6 dígitos de tu cliente"
                className={inputClass}
              />
              {isResolvingCustomer && <p className="text-xs text-[#6b6d64]">Buscando...</p>}
              {customerNotFound && <p className="text-xs text-red-500">No encontramos ese código.</p>}

              {customerAddress && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#6b6d64]">S/</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      value={fiarAmountSoles}
                      onChange={(e) => setFiarAmountSoles(e.target.value)}
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                    />
                  </div>
                  <button onClick={handleFiar} disabled={isFiarSubmitting} className={primaryButtonClass} style={primaryButtonStyle}>
                    {isFiarSubmitting ? "Fiando..." : "Fiar a este cliente"}
                  </button>
                </>
              )}
              {fiarError && <p className="text-xs text-red-500">{fiarError}</p>}
              {fiarConfirmed && <p className="text-xs text-green-600">¡Listo! Ya quedó registrado el fiado ✓</p>}
            </div>
          </div>
        )}
      </section>

      {invoiceEscrowAddress && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Fiado con garantía</h2>
          <p className="text-xs text-[#6b6d64]">
            Para montos más grandes, pídele a tu cliente un depósito parcial en vez de fiar sin
            garantía. Si no te paga antes del vencimiento, reclamas ese depósito.
          </p>

          {customerAddress && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">Monto S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={escrowPrincipalSoles}
                  onChange={(e) => setEscrowPrincipalSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">Garantía S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={escrowCollateralSoles}
                  onChange={(e) => setEscrowCollateralSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">Vence en (días)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={escrowDueDays}
                  onChange={(e) => setEscrowDueDays(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <button onClick={handleProposeInvoice} disabled={isProposing} className={primaryButtonClass} style={primaryButtonStyle}>
                {isProposing ? "Proponiendo..." : "Proponer a este cliente"}
              </button>
              {proposeError && <p className="text-xs text-red-500">{proposeError}</p>}
              {proposeConfirmed && (
                <p className="text-xs text-green-600">¡Listo! El cliente ya puede aceptarla y depositar la garantía ✓</p>
              )}
            </div>
          )}
          {!customerAddress && (
            <p className="text-xs text-[#6b6d64]">Busca un cliente arriba (en &quot;Fiar a un cliente&quot;) para proponerle una factura con garantía.</p>
          )}

          {myInvoices.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-[#0a0a0b]">Tus facturas con garantía</p>
              {myInvoices.map((inv) => (
                <div key={inv.id} className={highlightBoxClass}>
                  <p className="text-xs text-[#6b6d64]">
                    {formatSoles(Number(inv.principal) / 1e18)} · garantía {formatSoles(Number(inv.collateral) / 1e18)} · vence{" "}
                    {formatPaymentDate(Number(inv.dueDate))}
                  </p>
                  <p className="text-xs text-[#6b6d64]">
                    Pagado: {formatSoles(Number(inv.repaidAmount) / 1e18)} · Estado: {INVOICE_STATUS_LABEL[inv.status]}
                  </p>
                  {inv.status === 1 && (
                    <button
                      onClick={() => handleClaimCollateral(inv.id)}
                      disabled={claimingInvoiceId === inv.id}
                      className={`${outlineButtonClass} mt-2`}
                    >
                      {claimingInvoiceId === inv.id ? "Reclamando..." : "Reclamar garantía (si ya venció sin pagar)"}
                    </button>
                  )}
                </div>
              ))}
              {claimError && <p className="text-xs text-red-500">{claimError}</p>}
            </div>
          )}
        </section>
      )}

      {rewardsCatalogAddress && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Mi catálogo de beneficios</h2>
          <p className="text-xs text-[#6b6d64]">
            Armá lo que quieras dar a cambio de PUNTOS — un producto (arroz, gaseosa) o un
            sorteo para una fecha especial (aniversario, Navidad, Día de la Madre). Cualquier
            cliente de la red puede canjearlo, no solo el que compró en tu bodega.
          </p>

          <div className="flex flex-col gap-2">
            <input
              value={rewardTitle}
              onChange={(e) => setRewardTitle(e.target.value)}
              placeholder="Ej: 1kg de arroz, o Canasta navideña"
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRewardKind("Instant")}
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium ${rewardKind === "Instant" ? "border-black/35 bg-[#c9e26514]" : "border-black/15"}`}
              >
                Canje directo
              </button>
              <button
                type="button"
                onClick={() => setRewardKind("Raffle")}
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium ${rewardKind === "Raffle" ? "border-black/35 bg-[#c9e26514]" : "border-black/15"}`}
              >
                Sorteo
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">Costo en PUNTOS</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={rewardCostPuntos}
                onChange={(e) => setRewardCostPuntos(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">
                {rewardKind === "Instant" ? "Disponible por (días)" : "Cierra el sorteo en (días)"}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={rewardAvailableDays}
                onChange={(e) => setRewardAvailableDays(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">Código de canje válido por (horas)</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={rewardClaimWindowHours}
                onChange={(e) => setRewardClaimWindowHours(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
            <button onClick={handleCreateReward} disabled={isCreatingReward || !rewardTitle.trim()} className={primaryButtonClass} style={primaryButtonStyle}>
              {isCreatingReward ? "Creando..." : "Publicar beneficio"}
            </button>
            {createRewardError && <p className="text-xs text-red-500">{createRewardError}</p>}
            {createRewardConfirmed && <p className="text-xs text-green-600">¡Listo! Ya está en el catálogo ✓</p>}
          </div>

          {myRewards.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-[#0a0a0b]">Tus beneficios publicados</p>
              {myRewards.map((r) => (
                <div key={r.id} className={highlightBoxClass}>
                  <p className="text-sm font-medium text-[#0a0a0b]">{r.title}</p>
                  <p className="text-xs text-[#6b6d64]">
                    {REWARD_KIND_LABEL[r.kind]} · {(Number(r.pointCost) / 1e18).toFixed(0)} PUNTOS · {r.active ? "activo" : "pausado"}
                    {r.kind === 1 && r.drawn ? " · sorteado" : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleToggleRewardActive(r.id, r.active)}
                      disabled={togglingRewardId === r.id}
                      className={outlineButtonClass}
                    >
                      {togglingRewardId === r.id ? "..." : r.active ? "Pausar" : "Reactivar"}
                    </button>
                    {r.kind === 1 && !r.drawn && (
                      <button onClick={() => handleDrawWinner(r.id)} disabled={drawingRewardId === r.id} className={outlineButtonClass}>
                        {drawingRewardId === r.id ? "Sorteando..." : "Sortear ganador (si ya cerró)"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {rewardActionError && <p className="text-xs text-red-500">{rewardActionError}</p>}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-black/10 pt-3">
            <label htmlFor="redeemCode" className="text-sm font-medium text-[#0a0a0b]">
              Validar canje en el mostrador
            </label>
            <input
              id="redeemCode"
              inputMode="numeric"
              value={redeemCodeInput}
              onChange={(e) => setRedeemCodeInput(e.target.value)}
              placeholder="Código de 6 dígitos que te muestra el cliente"
              className={inputClass}
            />
            <button onClick={handleValidateCode} disabled={isValidatingCode || !redeemCodeInput.trim()} className={outlineButtonClass}>
              {isValidatingCode ? "Validando..." : "Entregar beneficio"}
            </button>
            {validateError && <p className="text-xs text-red-500">{validateError}</p>}
            {validateConfirmed && <p className="text-xs text-green-600">¡Listo! Canje entregado ✓</p>}
          </div>
        </section>
      )}

      {groupOrdersAddress && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Compras conjuntas entre bodegas</h2>
          <p className="text-xs text-[#6b6d64]">
            Si tu distribuidor pide un mínimo que solo no alcanzas, arma un pedido grupal.
            Otras bodegas aportan; si se llega a la meta, retiras el fondo para comprarle en la
            vida real y repartir según lo que aportó cada una. Si no se llega a la meta, cada
            una recupera lo suyo. Solo tiene sentido con bodegas realmente cerca — alguien tiene
            que ir a recoger el pedido a un solo punto, así que se muestran primero los pedidos
            de bodegas dentro de tu zona.
          </p>
          {(myLat === null || myLng === null) && (
            <p className="text-xs text-[#8f9189]">
              Guarda tu ubicación (más abajo) para que otras bodegas cercanas encuentren tu
              pedido más fácil.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <input
              value={groupOrderTitle}
              onChange={(e) => setGroupOrderTitle(e.target.value)}
              placeholder="Ej: Arroz + aceite — distribuidor de Miraflores"
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">Meta en soles</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="10"
                value={groupOrderGoalSoles}
                onChange={(e) => setGroupOrderGoalSoles(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">Se puede aportar por (días)</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={groupOrderPledgeDays}
                onChange={(e) => setGroupOrderPledgeDays(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">Plazo para retirar tras cerrar (días)</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={groupOrderWithdrawDays}
                onChange={(e) => setGroupOrderWithdrawDays(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
            <button
              onClick={handleCreateGroupOrder}
              disabled={isCreatingGroupOrder || !groupOrderTitle.trim()}
              className={primaryButtonClass}
              style={primaryButtonStyle}
            >
              {isCreatingGroupOrder ? "Creando..." : "Organizar pedido grupal"}
            </button>
            {createGroupOrderError && <p className="text-xs text-red-500">{createGroupOrderError}</p>}
            {createGroupOrderConfirmed && <p className="text-xs text-green-600">¡Listo! Ya está publicado ✓</p>}
          </div>

          {allGroupOrders.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[#0a0a0b]">Pedidos grupales cerca de ti</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#6b6d64]">Radio</span>
                  <select
                    value={groupOrderRadiusKm}
                    onChange={(e) => setGroupOrderRadiusKm(e.target.value === "all" ? "all" : Number(e.target.value))}
                    className="rounded-xl border border-black/15 bg-white px-2 py-1 text-xs text-[#0a0a0b] outline-none focus:border-black/35"
                  >
                    <option value={1}>1 km</option>
                    <option value={2}>2 km</option>
                    <option value={5}>5 km</option>
                    <option value="all">Todos</option>
                  </select>
                </div>
              </div>
              {(myLat === null || myLng === null) && (
                <p className="text-xs text-[#8f9189]">
                  Guarda tu ubicación (más abajo, en &quot;Tu ubicación en el mapa&quot;) para ver solo los pedidos de
                  bodegas cercanas — mientras tanto se muestran todos.
                </p>
              )}
              {nearbyGroupOrders.length === 0 && (
                <p className="text-xs text-[#8f9189]">No hay pedidos grupales dentro de ese radio todavía.</p>
              )}
              {nearbyGroupOrders.map((o) => {
                const isMine = address && o.organizer.toLowerCase() === (address as string).toLowerCase();
                return (
                  <div key={o.id} className={highlightBoxClass}>
                    <p className="text-sm font-medium text-[#0a0a0b]">{o.title}</p>
                    <p className="text-xs text-[#6b6d64]">
                      {formatSoles(Number(o.pledged) / 1e18)} de {formatSoles(Number(o.goal) / 1e18)} · cierra{" "}
                      {formatPaymentDate(Number(o.pledgeDeadline))}
                      {isMine ? " · tu pedido" : ""}
                      {o.withdrawn ? " · retirado" : ""}
                      {o.distanceFromMeKm !== null ? ` · a ${o.distanceFromMeKm.toFixed(1)} km` : ""}
                    </p>
                    {o.myPledge > BigInt(0) && (
                      <p className="text-xs text-[#6b6d64]">Aportaste: {formatSoles(Number(o.myPledge) / 1e18)}</p>
                    )}

                    {!o.withdrawn && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-sm text-[#6b6d64]">S/</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="1"
                          value={pledgeSolesByOrder[o.id] ?? ""}
                          onChange={(e) => setPledgeSolesByOrder((prev) => ({ ...prev, [o.id]: e.target.value }))}
                          className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                        />
                        <button
                          onClick={() => handlePledge(o.id)}
                          disabled={pledgingOrderId === o.id}
                          className={outlineButtonClass}
                        >
                          {pledgingOrderId === o.id ? "..." : "Aportar"}
                        </button>
                      </div>
                    )}

                    <div className="mt-2 flex gap-2">
                      {isMine && !o.withdrawn && (
                        <button
                          onClick={() => handleWithdrawGroupOrder(o.id)}
                          disabled={withdrawingOrderId === o.id}
                          className={outlineButtonClass}
                        >
                          {withdrawingOrderId === o.id ? "Retirando..." : "Retirar fondo (si ya se alcanzó la meta)"}
                        </button>
                      )}
                      {o.myPledge > BigInt(0) && !o.withdrawn && (
                        <button
                          onClick={() => handleRefundGroupOrder(o.id)}
                          disabled={refundingOrderId === o.id}
                          className={outlineButtonClass}
                        >
                          {refundingOrderId === o.id ? "..." : "Reclamar reembolso"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {groupOrdersWithoutLocation.length > 0 && (
                <details className="text-xs text-[#8f9189]">
                  <summary className="cursor-pointer">
                    {groupOrdersWithoutLocation.length} pedido{groupOrdersWithoutLocation.length === 1 ? "" : "s"} más de
                    bodegas sin ubicación registrada (no sabemos si están cerca)
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {groupOrdersWithoutLocation.map((o) => (
                      <div key={o.id} className={highlightBoxClass}>
                        <p className="text-sm font-medium text-[#0a0a0b]">{o.title}</p>
                        <p className="text-xs text-[#6b6d64]">
                          {formatSoles(Number(o.pledged) / 1e18)} de {formatSoles(Number(o.goal) / 1e18)} · cierra{" "}
                          {formatPaymentDate(Number(o.pledgeDeadline))}
                          {o.withdrawn ? " · retirado" : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {groupOrderActionError && <p className="text-xs text-red-500">{groupOrderActionError}</p>}
            </div>
          )}
        </section>
      )}

      {creditCertificateAddress && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Certificado de crédito</h2>
          <p className="text-xs text-[#6b6d64]">
            Probá que tu score supera un mínimo (ej. &quot;≥ 700&quot;) sin mostrarle a nadie la
            cifra exacta — un certificado que un banco, proveedor, o esta misma app pueden
            validar.
          </p>

          {certifiedThreshold > 0 && (
            <div className={highlightBoxClass}>
              <p className="text-sm text-[#0a0a0b]">Certificado vigente: score ≥ {certifiedThreshold}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-sm text-[#6b6d64]">Probar que mi score es al menos</span>
            <select
              value={certificateThreshold}
              onChange={(e) => setCertificateThreshold(e.target.value)}
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
            >
              <option value="500">500</option>
              <option value="700">700</option>
              <option value="900">900</option>
            </select>
          </div>
          <button
            onClick={handleGenerateCertificate}
            disabled={isGeneratingCertificate}
            className={primaryButtonClass}
            style={primaryButtonStyle}
          >
            {isGeneratingCertificate ? certificateStep ?? "Generando..." : "Generar certificado"}
          </button>
          {certificateError && <p className="text-xs text-red-500">{certificateError}</p>}
          {certificateConfirmed && <p className="text-xs text-green-600">¡Listo! Certificado emitido ✓</p>}
        </section>
      )}

      {creditLineAddress && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Línea de crédito</h2>
          <p className="text-xs text-[#6b6d64]">
            Con un certificado de crédito vigente, pedís prestado de un fondo compartido —
            cuanto mejor el score que probaste, menos garantía tenés que poner.
          </p>

          {myTierCollateralBps === null ? (
            <p className="text-xs text-[#8f9189]">Necesitas un certificado de crédito vigente para pedir prestado.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[#6b6d64]">Garantía requerida para tu nivel: {(myTierCollateralBps / 100).toFixed(0)}%</p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">Pedir prestado S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="10"
                  value={borrowAmountSoles}
                  onChange={(e) => setBorrowAmountSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <button onClick={handleBorrow} disabled={isBorrowing} className={outlineButtonClass}>
                {isBorrowing ? "Pidiendo..." : "Pedir préstamo"}
              </button>
              {borrowError && <p className="text-xs text-red-500">{borrowError}</p>}
            </div>
          )}

          {myLoans.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-[#0a0a0b]">Tus préstamos activos</p>
              {myLoans.map((loan) => (
                <div key={loan.id} className={highlightBoxClass}>
                  <p className="text-xs text-[#6b6d64]">
                    {formatSoles(Number(loan.principal) / 1e18)} · garantía {formatSoles(Number(loan.collateral) / 1e18)} · vence{" "}
                    {formatPaymentDate(Number(loan.dueDate))}
                  </p>
                  <button
                    onClick={() => handleRepayLoan(loan.id, loan.principal)}
                    disabled={repayingLoanId === loan.id}
                    className={`${outlineButtonClass} mt-2`}
                  >
                    {repayingLoanId === loan.id ? "Pagando..." : "Pagar préstamo"}
                  </button>
                </div>
              ))}
              {loanActionError && <p className="text-xs text-red-500">{loanActionError}</p>}
            </div>
          )}
        </section>
      )}

      {isBeneficioAdmin && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Panel de administrador — Beneficios sociales</h2>
          <p className="text-xs text-[#6b6d64]">
            Solo vos ves esta sección: tu cuenta es la autorizada para emitir beneficios sociales
            (programas como Vaso de Leche o Pensión 65). Cada sol emitido solo se puede gastar
            en una bodega registrada — no se puede revender ni cambiar por efectivo.
          </p>
          {registryOutOfSync && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-50 p-3">
              <p className="text-xs text-[#6b6d64]">
                La lista de bodegas que usa el sistema de beneficios para validar a quién se le
                puede pagar quedó desactualizada. Actualizala para que las bodegas nuevas puedan
                recibir beneficios.
              </p>
              <button
                onClick={handleSyncRegistry}
                disabled={isSyncingRegistry}
                className={`${outlineButtonClass} mt-2`}
              >
                {isSyncingRegistry ? "Actualizando..." : "Actualizar registro de bodegas"}
              </button>
              {syncRegistryError && <p className="mt-1 text-xs text-red-500">{syncRegistryError}</p>}
              {syncRegistryConfirmed && <p className="mt-1 text-xs text-green-600">¡Listo! Registro actualizado ✓</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="beneficiaryCode" className="text-sm font-medium text-[#0a0a0b]">
              Código del beneficiario
            </label>
            <input
              id="beneficiaryCode"
              inputMode="numeric"
              value={beneficiaryCodeInput}
              onChange={(e) => handleBeneficiaryCodeChange(e.target.value)}
              placeholder="Su código de 6 dígitos"
              className={inputClass}
            />
            {isResolvingBeneficiary && <p className="text-xs text-[#6b6d64]">Buscando...</p>}
            {beneficiaryNotFound && <p className="text-xs text-red-500">No encontramos ese código.</p>}

            {beneficiaryAddress && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#6b6d64]">S/</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={issueAmountSoles}
                    onChange={(e) => setIssueAmountSoles(e.target.value)}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#6b6d64]">Vence en (días)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={issueDurationDays}
                    onChange={(e) => setIssueDurationDays(e.target.value)}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-black/35"
                  />
                </div>
                <button onClick={handleIssue} disabled={isIssuing} className={primaryButtonClass} style={primaryButtonStyle}>
                  {isIssuing ? "Emitiendo..." : "Emitir beneficio"}
                </button>
              </>
            )}
            {issueError && <p className="text-xs text-red-500">{issueError}</p>}
            {issueConfirmed && <p className="text-xs text-green-600">¡Listo! Ya se emitió el beneficio ✓</p>}
          </div>
        </section>
      )}

      {TELEGRAM_BOT_USERNAME && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Tu perfil por Telegram</h2>
          {telegramLinked ? (
            <>
              <p className="text-xs text-green-600">
                ✓ Vinculado — te avisamos cuando te paguen y puedes escribirle /perfil al bot para ver tus
                pagos y tu fiado cuando quieras.
              </p>
              <button onClick={handleTestNotify} className={outlineButtonClass}>
                Mandarme un mensaje de prueba
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[#6b6d64]">
                Vincula tu bodega con Telegram para recibir avisos cuando te paguen y consultar tus pagos y
                tu fiado escribiéndole /perfil al bot, cuando quieras.
              </p>
              {!linkCode ? (
                <button onClick={handleGenerateCode} disabled={isGeneratingCode} className={primaryButtonClass} style={primaryButtonStyle}>
                  {isGeneratingCode ? "Generando..." : "1. Generar mi código"}
                </button>
              ) : (
                <>
                  <p className="text-xs text-[#6b6d64]">Tu código (vale por 10 minutos):</p>
                  <p className="text-center text-2xl font-semibold tracking-widest text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                    {linkCode}
                  </p>
                  <a
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${linkCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${primaryButtonClass} text-center`}
                    style={primaryButtonStyle}
                  >
                    2. Abrir el bot en Telegram y tocar Iniciar
                  </a>
                  <button onClick={handleCheckLinked} disabled={isLinkingTelegram} className={outlineButtonClass}>
                    {isLinkingTelegram ? "Revisando..." : "3. Ya lo hice, vincular"}
                  </button>
                </>
              )}
            </>
          )}
          {telegramMessage && <p className="text-xs text-[#6b6d64]">{telegramMessage}</p>}
        </section>
      )}
    </div>
  );
}
