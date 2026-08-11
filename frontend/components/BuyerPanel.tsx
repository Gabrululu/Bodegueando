"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { Map, MapMarker, MarkerContent, MarkerPopup } from "@/components/ui/map";
import {
  fiadoScoringAbi,
  fiadoScoringAddress,
  paymentRouterAbi,
  paymentRouterAddress,
  beneficioTokenAbi,
  beneficioTokenAddress,
  invoiceEscrowAbi,
  invoiceEscrowAddress,
  rewardsCatalogAbi,
  rewardsCatalogAddress,
  puntosTokenAbi,
  puntosTokenAddress,
  creditLineAbi,
  creditLineAddress,
} from "@/lib/contracts";
import { confianzaLabel } from "@/lib/fiado";
import { useExchangeRate } from "@/lib/useExchangeRate";
import { sendAndWait, useSmartAccountClient } from "@/lib/smartAccount";

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

const cardClass = "flex flex-col gap-3 rounded-[20px] border border-black/10 bg-[#fffffc] p-5 shadow-sm";
const sectionTitleClass =
  "text-sm font-semibold uppercase tracking-wide text-[#6b6d64] [font-family:var(--font-bricolage)]";
const inputClass =
  "rounded-xl border border-black/15 bg-white px-3 py-2 text-center text-lg font-semibold tracking-widest text-[#0a0a0b] outline-none focus:border-black/35";
const primaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const primaryButtonStyle = {
  background: "linear-gradient(180deg, #d6f17b 0%, #c9e265 100%)",
  boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
};
const outlineButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50";
const highlightBoxClass = "flex flex-col gap-3 rounded-xl border border-black/5 bg-[#c9e26514] p-4";

/**
 * Vista del comprador: buscar una bodega por su código, ver si ofrece fiado (solo si
 * la bodega lo activó — ver BodegaOwnerPanel.tsx) y pagarle. El comprador no puede
 * prender/apagar el fiado de nadie ni pedirle a la IA que lo recalcule, esas acciones
 * son del bodeguero.
 */
export function BuyerPanel({ initialCode }: { initialCode?: string } = {}) {
  const { client: smartAccountClient, address, isLoading: isAccountLoading } = useSmartAccountClient();
  const isConnected = Boolean(address);
  const [bodegaCodeInput, setBodegaCodeInput] = useState(initialCode ?? "");
  const [bodegaAddress, setBodegaAddress] = useState<Address | undefined>(undefined);
  const [isResolvingCode, setIsResolvingCode] = useState(false);
  const [codeNotFound, setCodeNotFound] = useState(false);
  const [amountSoles, setAmountSoles] = useState("13");
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isPaySubmitting, setIsPaySubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [isPayConfirmed, setIsPayConfirmed] = useState(false);

  const { formatSoles, solesToEth, ethPen } = useExchangeRate();
  const [myCode, setMyCode] = useState<string | null>(null);
  const [repayAmountSoles, setRepayAmountSoles] = useState("");
  const [isRepaySubmitting, setIsRepaySubmitting] = useState(false);
  const [repayError, setRepayError] = useState<string | null>(null);
  const [isRepayConfirmed, setIsRepayConfirmed] = useState(false);
  const [benefitAmountSoles, setBenefitAmountSoles] = useState("");
  const [isRedeemSubmitting, setIsRedeemSubmitting] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [isRedeemConfirmed, setIsRedeemConfirmed] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);
  const [myLat, setMyLat] = useState<number | null>(null);
  const [myLng, setMyLng] = useState<number | null>(null);
  const [nearbyBodegas, setNearbyBodegas] = useState<Array<{ address: string; lat: number; lng: number }>>([]);
  const [bodegaCodesByLocationAddress, setBodegaCodesByLocationAddress] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLat(position.coords.latitude);
        setMyLng(position.coords.longitude);
      },
      () => {
        // Denied or unavailable — the map just falls back to centering on Lima.
      },
    );
  }, []);

  useEffect(() => {
    fetch("/api/bodega/location")
      .then((res) => res.json())
      .then((data) => setNearbyBodegas(data.locations ?? []))
      .catch(() => setNearbyBodegas([]));
  }, []);

  useEffect(() => {
    const uncached = nearbyBodegas.map((b) => b.address).filter((a) => !(a in bodegaCodesByLocationAddress));
    if (uncached.length === 0) return;
    uncached.forEach((bodegaAddr) => {
      fetch("/api/bodega/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: bodegaAddr, pool: "bodega" }),
      })
        .then((res) => res.json())
        .then((data) => setBodegaCodesByLocationAddress((prev) => ({ ...prev, [bodegaAddr]: data.code ?? "?" })))
        .catch(() => setBodegaCodesByLocationAddress((prev) => ({ ...prev, [bodegaAddr]: "?" })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearbyBodegas.map((b) => b.address).join(",")]);

  const contractsConfigured = Boolean(fiadoScoringAddress && paymentRouterAddress);

  const isValidCodeFormat = /^\d{6,9}$/.test(bodegaCodeInput.trim());

  useEffect(() => {
    if (!isValidCodeFormat) return;
    const code = bodegaCodeInput.trim();
    let cancelled = false;

    async function resolve() {
      setIsResolvingCode(true);
      setCodeNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}&pool=bodega`);
        const data = await res.json();
        if (cancelled) return;
        if (data.address) {
          setBodegaAddress(data.address as Address);
        } else {
          setBodegaAddress(undefined);
          setCodeNotFound(true);
        }
      } catch {
        if (!cancelled) {
          setBodegaAddress(undefined);
          setCodeNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolvingCode(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [bodegaCodeInput, isValidCodeFormat]);

  function handleBodegaCodeChange(value: string) {
    const trimmed = value.trim();
    setBodegaCodeInput(trimmed);
    if (!/^\d{6,9}$/.test(trimmed)) {
      setBodegaAddress(undefined);
      setCodeNotFound(false);
    }
  }

  const isBodegaQuery = useReadContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: "isBodega",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && paymentRouterAddress) },
  });
  const isRealBodega = isBodegaQuery.data === true;
  const codeIsNotABodega = Boolean(bodegaAddress) && !isBodegaQuery.isLoading && !isRealBodega;

  const fiadoEnabledQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "isFiadoEnabled",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress) },
  });
  const fiadoEnabled = fiadoEnabledQuery.data === true;

  const scoreQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getScore",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress && fiadoEnabled) },
  });

  const limitQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getCreditLimit",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress && fiadoEnabled) },
  });

  const aiInfoQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getAiAdjustmentInfo",
    args: bodegaAddress ? [bodegaAddress] : undefined,
    query: { enabled: Boolean(bodegaAddress && fiadoScoringAddress && fiadoEnabled) },
  });

  const debtQuery = useReadContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "getFiadoDebt",
    args: bodegaAddress && address ? [bodegaAddress, address] : undefined,
    query: { enabled: Boolean(bodegaAddress && address && fiadoScoringAddress && fiadoEnabled) },
  });
  const debtWei = (debtQuery.data as bigint | undefined) ?? BigInt(0);

  useEffect(() => {
    if (debtWei > BigInt(0) && repayAmountSoles === "") {
      setRepayAmountSoles(((Number(debtWei) / 1e18) * ethPen).toFixed(2));
    }
  }, [debtWei, ethPen, repayAmountSoles]);

  const benefitBalanceQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && beneficioTokenAddress) },
  });
  const benefitExpiryQuery = useReadContract({
    address: beneficioTokenAddress,
    abi: beneficioTokenAbi,
    functionName: "expiresAt",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && beneficioTokenAddress) },
  });
  const benefitBalanceWei = (benefitBalanceQuery.data as bigint | undefined) ?? BigInt(0);
  const benefitExpiresAt = Number((benefitExpiryQuery.data as bigint | undefined) ?? BigInt(0));
  // No se pre-valida el vencimiento acá: BeneficioToken._update ya lo hace cumplir on-chain
  // (revierte con BenefitExpired), así que si el beneficio venció, el intento de pago
  // simplemente revierte y se muestra el mismo mensaje de error genérico de abajo.
  const hasBenefit = benefitBalanceWei > BigInt(0);

  useEffect(() => {
    if (hasBenefit && bodegaAddress && benefitAmountSoles === "") {
      setBenefitAmountSoles((Number(benefitBalanceWei) / 1e18).toFixed(2));
    }
  }, [hasBenefit, bodegaAddress, benefitBalanceWei, benefitAmountSoles]);

  async function handleRedeemBenefit() {
    if (!bodegaAddress || !beneficioTokenAddress || !smartAccountClient || !address) return;
    setIsRedeemSubmitting(true);
    setRedeemError(null);
    setIsRedeemConfirmed(false);
    try {
      const amountWei = parseEther((benefitAmountSoles || "0").trim() || "0");
      await sendAndWait(smartAccountClient, address, [
        {
          address: beneficioTokenAddress,
          abi: beneficioTokenAbi,
          functionName: "transfer",
          args: [bodegaAddress, amountWei],
        },
      ]);
      setIsRedeemConfirmed(true);
      setBenefitAmountSoles("");
      benefitBalanceQuery.refetch();
    } catch {
      setRedeemError("No se pudo pagar con tu beneficio. Revisa el monto e intenta de nuevo.");
    } finally {
      setIsRedeemSubmitting(false);
    }
  }

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
    .filter((inv) => address && inv.customer.toLowerCase() === (address as string).toLowerCase())
    .filter((inv) => inv.status === 0 || inv.status === 1) // Proposed or Active — the only actionable ones
    .reverse();

  const [invoiceRepaySoles, setInvoiceRepaySoles] = useState<Record<number, string>>({});
  const [acceptingInvoiceId, setAcceptingInvoiceId] = useState<number | null>(null);
  const [repayingInvoiceId, setRepayingInvoiceId] = useState<number | null>(null);
  const [invoiceActionError, setInvoiceActionError] = useState<string | null>(null);

  async function handleAcceptInvoice(id: number, collateral: bigint) {
    if (!invoiceEscrowAddress || !smartAccountClient || !address) return;
    setAcceptingInvoiceId(id);
    setInvoiceActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: invoiceEscrowAddress, abi: invoiceEscrowAbi, functionName: "acceptInvoice", args: [BigInt(id)], value: collateral },
      ]);
      invoicesQuery.refetch();
    } catch {
      setInvoiceActionError("No se pudo aceptar la factura. Revisa que tengas saldo para la garantía.");
    } finally {
      setAcceptingInvoiceId(null);
    }
  }

  async function handleRepayInvoice(id: number) {
    if (!invoiceEscrowAddress || !smartAccountClient || !address) return;
    setRepayingInvoiceId(id);
    setInvoiceActionError(null);
    try {
      const amountWei = parseEther(solesToEth(Number(invoiceRepaySoles[id] || "0")).toFixed(18));
      await sendAndWait(smartAccountClient, address, [
        { address: invoiceEscrowAddress, abi: invoiceEscrowAbi, functionName: "repayInvoice", args: [BigInt(id)], value: amountWei },
      ]);
      setInvoiceRepaySoles((prev) => ({ ...prev, [id]: "" }));
      invoicesQuery.refetch();
    } catch {
      setInvoiceActionError("No se pudo pagar esta factura. Intenta de nuevo.");
    } finally {
      setRepayingInvoiceId(null);
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

  const allRewards = (rewardsQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [rBodega, title, kind, pointCost, availableUntil, , active, drawn] = result.result as [
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
      return { id: i, bodega: rBodega, title, kind, pointCost, availableUntil, active, drawn };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => r.active && (r.kind === 0 || !r.drawn))
    .reverse();

  const [bodegaCodesByAddress, setBodegaCodesByAddress] = useState<Record<string, string>>({});
  useEffect(() => {
    const uncached = Array.from(new Set(allRewards.map((r) => r.bodega.toLowerCase()))).filter((a) => !(a in bodegaCodesByAddress));
    if (uncached.length === 0) return;
    uncached.forEach((bodegaAddr) => {
      fetch("/api/bodega/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: bodegaAddr, pool: "bodega" }),
      })
        .then((res) => res.json())
        .then((data) => setBodegaCodesByAddress((prev) => ({ ...prev, [bodegaAddr]: data.code ?? "?" })))
        .catch(() => setBodegaCodesByAddress((prev) => ({ ...prev, [bodegaAddr]: "?" })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRewards.map((r) => r.bodega).join(",")]);

  const redemptionCountQuery = useReadContract({
    address: rewardsCatalogAddress,
    abi: rewardsCatalogAbi,
    functionName: "nextRedemptionId",
    query: { enabled: Boolean(rewardsCatalogAddress) },
  });
  const redemptionCount = Number((redemptionCountQuery.data as bigint | undefined) ?? BigInt(0));

  const redemptionsQuery = useReadContracts({
    contracts: Array.from({ length: redemptionCount }, (_, i) => ({
      address: rewardsCatalogAddress,
      abi: rewardsCatalogAbi,
      functionName: "redemptions",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(rewardsCatalogAddress) && redemptionCount > 0 },
  });

  const myRedemptions = (redemptionsQuery.data ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const [rewardId, customer, code, expiresAt, fulfilled] = result.result as [bigint, Address, bigint, bigint, boolean];
      return { id: i, rewardId: Number(rewardId), customer, code, expiresAt, fulfilled };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => address && r.customer.toLowerCase() === (address as string).toLowerCase())
    .reverse();

  const [redeemingRewardId, setRedeemingRewardId] = useState<number | null>(null);
  const [rewardActionError, setRewardActionError] = useState<string | null>(null);

  async function handleRedeemInstant(id: number, pointCost: bigint) {
    if (!rewardsCatalogAddress || !puntosTokenAddress || !smartAccountClient || !address) return;
    setRedeemingRewardId(id);
    setRewardActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: puntosTokenAddress, abi: puntosTokenAbi, functionName: "approve", args: [rewardsCatalogAddress, pointCost] },
        { address: rewardsCatalogAddress, abi: rewardsCatalogAbi, functionName: "redeemInstant", args: [BigInt(id)] },
      ]);
      redemptionCountQuery.refetch();
      redemptionsQuery.refetch();
    } catch {
      setRewardActionError("No se pudo canjear. Revisa que tengas suficientes PUNTOS.");
    } finally {
      setRedeemingRewardId(null);
    }
  }

  async function handleEnterRaffle(id: number, pointCost: bigint) {
    if (!rewardsCatalogAddress || !puntosTokenAddress || !smartAccountClient || !address) return;
    setRedeemingRewardId(id);
    setRewardActionError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: puntosTokenAddress, abi: puntosTokenAbi, functionName: "approve", args: [rewardsCatalogAddress, pointCost] },
        { address: rewardsCatalogAddress, abi: rewardsCatalogAbi, functionName: "enterRaffle", args: [BigInt(id)] },
      ]);
    } catch {
      setRewardActionError("No se pudo participar. Revisa que tengas suficientes PUNTOS.");
    } finally {
      setRedeemingRewardId(null);
    }
  }

  const [lenderDepositSoles, setLenderDepositSoles] = useState("50");
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [isWithdrawingLender, setIsWithdrawingLender] = useState(false);
  const [withdrawLenderError, setWithdrawLenderError] = useState<string | null>(null);
  const [liquidatingLoanId, setLiquidatingLoanId] = useState<number | null>(null);
  const [liquidateError, setLiquidateError] = useState<string | null>(null);

  const lenderSharesQuery = useReadContract({
    address: creditLineAddress,
    abi: creditLineAbi,
    functionName: "lenderShares",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && creditLineAddress) },
  });
  const myLenderShares = (lenderSharesQuery.data as bigint | undefined) ?? BigInt(0);

  const poolBalanceQuery = useReadContract({
    address: creditLineAddress,
    abi: creditLineAbi,
    functionName: "poolBalance",
    query: { enabled: Boolean(creditLineAddress) },
  });
  const poolBalanceWei = (poolBalanceQuery.data as bigint | undefined) ?? BigInt(0);

  const overdueLoanCountQuery = useReadContract({
    address: creditLineAddress,
    abi: creditLineAbi,
    functionName: "nextLoanId",
    query: { enabled: Boolean(creditLineAddress) },
  });
  const overdueLoanCount = Number((overdueLoanCountQuery.data as bigint | undefined) ?? BigInt(0));

  const overdueLoansQuery = useReadContracts({
    contracts: Array.from({ length: overdueLoanCount }, (_, i) => ({
      address: creditLineAddress,
      abi: creditLineAbi,
      functionName: "loans",
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(creditLineAddress) && overdueLoanCount > 0 },
  });
  const overdueLoans = (overdueLoansQuery.data ?? [])
    .map((r, i) => {
      if (r.status !== "success") return null;
      const [loanBodega, principal, collateral, , dueDate, resolved] = r.result as [Address, bigint, bigint, bigint, bigint, boolean];
      return { id: i, bodega: loanBodega, principal, collateral, dueDate, resolved };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .filter((l) => !l.resolved)
    .reverse();

  async function handleDeposit() {
    if (!creditLineAddress || !smartAccountClient || !address) return;
    setIsDepositing(true);
    setDepositError(null);
    try {
      const amountWei = parseEther(solesToEth(Number(lenderDepositSoles || "0")).toFixed(18));
      await sendAndWait(smartAccountClient, address, [
        { address: creditLineAddress, abi: creditLineAbi, functionName: "deposit", args: [], value: amountWei },
      ]);
      lenderSharesQuery.refetch();
      poolBalanceQuery.refetch();
    } catch {
      setDepositError("No se pudo depositar. Intenta de nuevo.");
    } finally {
      setIsDepositing(false);
    }
  }

  async function handleWithdrawLender() {
    if (!creditLineAddress || !smartAccountClient || !address || myLenderShares === BigInt(0)) return;
    setIsWithdrawingLender(true);
    setWithdrawLenderError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: creditLineAddress, abi: creditLineAbi, functionName: "withdraw", args: [myLenderShares] },
      ]);
      lenderSharesQuery.refetch();
      poolBalanceQuery.refetch();
    } catch {
      setWithdrawLenderError("No se pudo retirar. Intenta de nuevo.");
    } finally {
      setIsWithdrawingLender(false);
    }
  }

  async function handleLiquidate(loanId: number) {
    if (!creditLineAddress || !smartAccountClient || !address) return;
    setLiquidatingLoanId(loanId);
    setLiquidateError(null);
    try {
      await sendAndWait(smartAccountClient, address, [
        { address: creditLineAddress, abi: creditLineAbi, functionName: "liquidate", args: [BigInt(loanId)] },
      ]);
      overdueLoansQuery.refetch();
      poolBalanceQuery.refetch();
    } catch {
      setLiquidateError("Todavía no venció este préstamo.");
    } finally {
      setLiquidatingLoanId(null);
    }
  }

  async function handleRepay() {
    if (!bodegaAddress || !paymentRouterAddress || !smartAccountClient || !address) return;
    setIsRepaySubmitting(true);
    setRepayError(null);
    setIsRepayConfirmed(false);
    try {
      const ethAmount = solesToEth(Number(repayAmountSoles || "0"));
      await sendAndWait(smartAccountClient, address, [
        {
          address: paymentRouterAddress,
          abi: paymentRouterAbi,
          functionName: "payFiado",
          args: [bodegaAddress],
          value: parseEther(ethAmount.toFixed(18)),
        },
      ]);
      setIsRepayConfirmed(true);
      setRepayAmountSoles("");
      debtQuery.refetch();
    } catch {
      setRepayError("No se pudo completar el pago del fiado. Intenta de nuevo.");
    } finally {
      setIsRepaySubmitting(false);
    }
  }

  useEffect(() => {
    if (!address) return;
    fetch("/api/bodega/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, pool: "buyer" }),
    })
      .then((res) => res.json())
      .then((data) => setMyCode(data.code ?? null))
      .catch(() => setMyCode(null));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.funded) {
          setFaucetMessage(`🎁 Te regalamos ${formatSoles(Number(data.amountEth))} de saldo de prueba para que puedas probar la app.`);
        } else if (data.reason === "faucet_error") {
          console.error("[faucet] no se pudo fondear la cuenta", address);
        }
      })
      .catch((err) => console.error("[faucet] request failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function handlePay() {
    if (!bodegaAddress || !paymentRouterAddress || !smartAccountClient || !address) return;
    setIsPaySubmitting(true);
    setPayError(null);
    setIsPayConfirmed(false);
    try {
      const ethAmount = solesToEth(Number(amountSoles || "0"));
      await sendAndWait(smartAccountClient, address, [
        {
          address: paymentRouterAddress,
          abi: paymentRouterAbi,
          functionName: "receivePayment",
          args: [bodegaAddress],
          value: parseEther(ethAmount.toFixed(18)),
        },
      ]);

      setIsPayConfirmed(true);
      fiadoEnabledQuery.refetch();
      scoreQuery.refetch();
      limitQuery.refetch();
      aiInfoQuery.refetch();

      // Best-effort: avisar por Telegram si la bodega vinculó su cuenta. No bloquea
      // ni muestra error al comprador si falla — el pago ya está confirmado on-chain.
      fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodegaAddress,
          text: `💰 Te pagaron S/ ${Number(amountSoles || "0").toFixed(2)} en Bodegueando.`,
        }),
      }).catch(() => {});
    } catch {
      setPayError("No se pudo completar el pago. Intenta de nuevo.");
    } finally {
      setIsPaySubmitting(false);
    }
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

  const payDisabledReason = !isConnected
    ? isAccountLoading
      ? "Preparando tu cuenta…"
      : "Ingresa arriba para poder pagar."
    : null;

  return (
    <div className="flex w-full max-w-md flex-col gap-8 text-left">
      {faucetMessage && (
        <p className="rounded-xl border border-black/5 bg-[#c9e26514] px-4 py-3 text-sm text-[#0a0a0b]">
          {faucetMessage}
        </p>
      )}

      {nearbyBodegas.length > 0 && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Bodegas cercanas</h2>
          <div className="h-[280px] w-full overflow-hidden rounded-xl border border-black/10">
            <Map center={[myLng ?? -77.0428, myLat ?? -12.0464]} zoom={myLat !== null ? 14 : 11}>
              {nearbyBodegas.map((b) => (
                <MapMarker key={b.address} longitude={b.lng} latitude={b.lat}>
                  <MarkerContent />
                  <MarkerPopup>
                    <div className="flex flex-col gap-2 p-2 text-center">
                      <p className="text-xs text-[#6b6d64]">Bodega #{bodegaCodesByLocationAddress[b.address] ?? "…"}</p>
                      {bodegaCodesByLocationAddress[b.address] && (
                        <a href={`/pagar/${bodegaCodesByLocationAddress[b.address]}`} className={outlineButtonClass}>
                          Pagar acá
                        </a>
                      )}
                    </div>
                  </MarkerPopup>
                </MapMarker>
              ))}
            </Map>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="bodega" className="text-sm font-medium text-[#0a0a0b]">
          Código de la bodega
        </label>
        <input
          id="bodega"
          inputMode="numeric"
          value={bodegaCodeInput}
          onChange={(e) => handleBodegaCodeChange(e.target.value)}
          placeholder="El código del cartel de la bodega"
          className={inputClass}
        />
        {isResolvingCode && <p className="text-xs text-[#6b6d64]">Buscando...</p>}
        {codeNotFound && <p className="text-xs text-red-500">No encontramos esa bodega, revisa el código.</p>}
        {codeIsNotABodega && (
          <p className="text-xs text-red-500">
            Ese código no corresponde a una bodega — revisa que sea el código que te mostró el
            cartel o QR de la tienda, no el tuyo.
          </p>
        )}
      </div>

      {bodegaAddress && isRealBodega && fiadoEnabled && (
        <div className={highlightBoxClass}>
          <div>
            <p className="text-xs text-[#6b6d64]">Fiado disponible en esta bodega</p>
            <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              {limitQuery.isLoading ? "…" : formatSoles(limitEth)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[#6b6d64]">Confianza:</span>
            <span className={`font-medium ${confianza.color}`}>
              {scoreQuery.isLoading ? "…" : confianza.text}
            </span>
            <span className="text-xs text-[#6b6d64]">
              ({scoreQuery.isLoading ? "…" : score}/1000{aiAdjusted ? ", ajustado por IA" : ""})
            </span>
          </div>

          {debtWei > BigInt(0) && (
            <div className="mt-1 flex flex-col gap-2 border-t border-black/10 pt-3">
              <p className="text-xs text-[#6b6d64]">
                Le debes a esta bodega: <span className="font-medium text-[#0a0a0b]">{formatSoles(Number(debtWei) / 1e18)}</span>
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={repayAmountSoles}
                  onChange={(e) => setRepayAmountSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-base text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <button onClick={handleRepay} disabled={!isConnected || isRepaySubmitting} className={outlineButtonClass}>
                {isRepaySubmitting ? "Pagando..." : "Pagar mi fiado"}
              </button>
              {repayError && <p className="text-xs text-red-500">{repayError}</p>}
              {isRepayConfirmed && <p className="text-xs text-green-600">¡Listo! Se descontó de tu deuda ✓</p>}
            </div>
          )}
        </div>
      )}
      {bodegaAddress && isRealBodega && !fiadoEnabled && !fiadoEnabledQuery.isLoading && (
        <p className="text-xs text-[#8f9189]">Esta bodega no ofrece fiado por ahora.</p>
      )}

      {isConnected && hasBenefit && (
        <div className={highlightBoxClass}>
          <div>
            <p className="text-xs text-[#6b6d64]">Tu beneficio social disponible</p>
            <p className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              S/ {(Number(benefitBalanceWei) / 1e18).toFixed(2)}
            </p>
            {benefitExpiresAt > 0 && (
              <p className="text-xs text-[#6b6d64]">
                Vence el {new Date(benefitExpiresAt * 1000).toLocaleDateString("es-PE")}
              </p>
            )}
          </div>
          <p className="text-xs text-[#6b6d64]">
            Solo se puede gastar en una bodega registrada — no se puede cambiar por efectivo ni
            mandarlo a otra persona.
          </p>
          {bodegaAddress && isRealBodega ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6b6d64]">S/</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={benefitAmountSoles}
                  onChange={(e) => setBenefitAmountSoles(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-base text-[#0a0a0b] outline-none focus:border-black/35"
                />
              </div>
              <button onClick={handleRedeemBenefit} disabled={isRedeemSubmitting} className={outlineButtonClass}>
                {isRedeemSubmitting ? "Pagando..." : "Pagar con tu beneficio social"}
              </button>
              {redeemError && <p className="text-xs text-red-500">{redeemError}</p>}
              {isRedeemConfirmed && <p className="text-xs text-green-600">¡Listo! Se pagó con tu beneficio ✓</p>}
            </>
          ) : (
            <p className="text-xs text-[#8f9189]">Escribe el código de la bodega arriba para pagar con esto.</p>
          )}
        </div>
      )}

      {isConnected && myInvoices.length > 0 && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Facturas con garantía</h2>
          <p className="text-xs text-[#6b6d64]">
            Fiado con depósito parcial que te propuso una bodega. Si aceptas, el depósito queda
            retenido hasta que termines de pagar; si no pagas antes del vencimiento, la bodega
            puede reclamarlo.
          </p>
          {myInvoices.map((inv) => (
            <div key={inv.id} className={highlightBoxClass}>
              <p className="text-xs text-[#6b6d64]">
                Monto: <span className="font-medium text-[#0a0a0b]">{formatSoles(Number(inv.principal) / 1e18)}</span> · Garantía:{" "}
                {formatSoles(Number(inv.collateral) / 1e18)}
              </p>
              <p className="text-xs text-[#6b6d64]">Vence el {new Date(Number(inv.dueDate) * 1000).toLocaleDateString("es-PE")}</p>

              {inv.status === 0 && (
                <button
                  onClick={() => handleAcceptInvoice(inv.id, inv.collateral)}
                  disabled={acceptingInvoiceId === inv.id}
                  className={outlineButtonClass}
                >
                  {acceptingInvoiceId === inv.id ? "Aceptando..." : `Aceptar y depositar ${formatSoles(Number(inv.collateral) / 1e18)}`}
                </button>
              )}

              {inv.status === 1 && (
                <div className="mt-1 flex flex-col gap-2 border-t border-black/10 pt-3">
                  <p className="text-xs text-[#6b6d64]">
                    Ya pagaste: {formatSoles(Number(inv.repaidAmount) / 1e18)} de {formatSoles(Number(inv.principal) / 1e18)}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#6b6d64]">S/</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      value={invoiceRepaySoles[inv.id] ?? ""}
                      onChange={(e) => setInvoiceRepaySoles((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-base text-[#0a0a0b] outline-none focus:border-black/35"
                    />
                  </div>
                  <button
                    onClick={() => handleRepayInvoice(inv.id)}
                    disabled={repayingInvoiceId === inv.id}
                    className={outlineButtonClass}
                  >
                    {repayingInvoiceId === inv.id ? "Pagando..." : "Pagar esta factura"}
                  </button>
                </div>
              )}
            </div>
          ))}
          {invoiceActionError && <p className="text-xs text-red-500">{invoiceActionError}</p>}
        </section>
      )}

      {isConnected && rewardsCatalogAddress && myRedemptions.length > 0 && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Mis canjes</h2>
          <p className="text-xs text-[#6b6d64]">Mostrale este código al bodeguero para retirar tu beneficio.</p>
          {myRedemptions.map((r) => (
            <div key={r.id} className={highlightBoxClass}>
              <p className="text-center text-3xl font-semibold tracking-widest text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                {r.fulfilled ? "Entregado ✓" : String(r.code)}
              </p>
              {!r.fulfilled && (
                <p className="mt-1 text-center text-xs text-[#6b6d64]">
                  Válido hasta {new Date(Number(r.expiresAt) * 1000).toLocaleString("es-PE")}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {isConnected && rewardsCatalogAddress && allRewards.length > 0 && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Catálogo de beneficios</h2>
          <p className="text-xs text-[#6b6d64]">
            Canjeá tus PUNTOS en cualquier bodega de la red, no solo donde los ganaste.
          </p>
          {allRewards.map((r) => (
            <div key={r.id} className={highlightBoxClass}>
              <p className="text-sm font-medium text-[#0a0a0b]">{r.title}</p>
              <p className="text-xs text-[#6b6d64]">
                {(Number(r.pointCost) / 1e18).toFixed(0)} PUNTOS · bodega #{bodegaCodesByAddress[r.bodega.toLowerCase()] ?? "…"}
              </p>
              <button
                onClick={() => (r.kind === 0 ? handleRedeemInstant(r.id, r.pointCost) : handleEnterRaffle(r.id, r.pointCost))}
                disabled={redeemingRewardId === r.id}
                className={`${outlineButtonClass} mt-2`}
              >
                {redeemingRewardId === r.id ? "Enviando..." : r.kind === 0 ? "Canjear" : "Participar del sorteo"}
              </button>
            </div>
          ))}
          {rewardActionError && <p className="text-xs text-red-500">{rewardActionError}</p>}
        </section>
      )}

      {isConnected && creditLineAddress && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Prestar al fondo de crédito</h2>
          <p className="text-xs text-[#6b6d64]">
            Cualquier cuenta puede prestar acá — las bodegas con certificado de crédito
            piden prestado con menos garantía, y lo que pagan (con interés) vuelve al fondo.
          </p>
          <p className="text-xs text-[#6b6d64]">Fondos disponibles: {formatSoles(Number(poolBalanceWei) / 1e18)}</p>

          <div className="flex items-center gap-2">
            <span className="text-sm text-[#6b6d64]">S/</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="10"
              value={lenderDepositSoles}
              onChange={(e) => setLenderDepositSoles(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-base text-[#0a0a0b] outline-none focus:border-black/35"
            />
            <button onClick={handleDeposit} disabled={isDepositing} className={outlineButtonClass}>
              {isDepositing ? "..." : "Depositar"}
            </button>
          </div>
          {depositError && <p className="text-xs text-red-500">{depositError}</p>}

          {myLenderShares > BigInt(0) && (
            <div className="flex items-center gap-2">
              <button onClick={handleWithdrawLender} disabled={isWithdrawingLender} className={outlineButtonClass}>
                {isWithdrawingLender ? "Retirando..." : "Retirar todo mi depósito"}
              </button>
            </div>
          )}
          {withdrawLenderError && <p className="text-xs text-red-500">{withdrawLenderError}</p>}

          {overdueLoans.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-black/10 pt-3">
              <p className="text-xs font-medium text-[#0a0a0b]">Préstamos activos (reclamables si ya vencieron)</p>
              {overdueLoans.map((loan) => (
                <div key={loan.id} className={highlightBoxClass}>
                  <p className="text-xs text-[#6b6d64]">
                    {formatSoles(Number(loan.principal) / 1e18)} · garantía {formatSoles(Number(loan.collateral) / 1e18)} · vence{" "}
                    {new Date(Number(loan.dueDate) * 1000).toLocaleDateString("es-PE")}
                  </p>
                  <button
                    onClick={() => handleLiquidate(loan.id)}
                    disabled={liquidatingLoanId === loan.id}
                    className={`${outlineButtonClass} mt-2`}
                  >
                    {liquidatingLoanId === loan.id ? "..." : "Reclamar (si ya venció)"}
                  </button>
                </div>
              ))}
              {liquidateError && <p className="text-xs text-red-500">{liquidateError}</p>}
            </div>
          )}
        </section>
      )}

      {bodegaAddress && isRealBodega && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Pagar en la bodega</h2>

          <div className="flex flex-col gap-1">
            <label htmlFor="amount" className="text-sm font-medium text-[#0a0a0b]">
              ¿Cuánto vas a pagar?
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#6b6d64]">S/</span>
              <input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                value={amountSoles}
                onChange={(e) => setAmountSoles(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-base text-[#0a0a0b] outline-none focus:border-black/35"
              />
            </div>
          </div>

          <button
            onClick={handlePay}
            disabled={!isConnected || isPaySubmitting}
            className={primaryButtonClass}
            style={primaryButtonStyle}
          >
            {isPaySubmitting ? "Pagando..." : "Pagar"}
          </button>
          {payDisabledReason && <p className="text-xs text-[#6b6d64]">{payDisabledReason}</p>}
          {payError && <p className="text-xs text-red-500">{payError}</p>}
          {isPayConfirmed && <p className="text-xs text-green-600">¡Listo! Tu pago se registró ✓</p>}
        </section>
      )}
      {!isRealBodega && !bodegaAddress && (
        <p className="text-xs text-[#8f9189]">Escribe arriba el código de la bodega para poder pagar.</p>
      )}

      {isConnected && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Tu código para que te fíen</h2>
          <p className="text-xs text-[#6b6d64]">
            Muéstraselo a tu bodega si te va a fiar — así el fiado queda registrado a tu nombre.
          </p>
          {myCode ? (
            <p className="text-center text-2xl font-semibold tracking-widest text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              {myCode}
            </p>
          ) : (
            <p className="text-xs text-[#6b6d64]">Generando tu código…</p>
          )}
        </section>
      )}

      {isConnected && TELEGRAM_BOT_USERNAME && (
        <section className={cardClass}>
          <h2 className={sectionTitleClass}>Tus puntos por Telegram</h2>
          {telegramLinked ? (
            <p className="text-xs text-green-600">
              ✓ Vinculado — escríbele /perfil al bot cuando quieras ver tus puntos acumulados.
            </p>
          ) : (
            <>
              <p className="text-xs text-[#6b6d64]">
                Vincula tu cuenta con Telegram para consultar tus puntos escribiéndole /perfil al bot.
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
