"use client";

import { useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { creditCertificateAbi, creditCertificateAddress, creditLineAbi, creditLineAddress } from "@/lib/contracts";
import { RISK_COLOR, RISK_LABEL, confianzaLabel, type AiRecommendation } from "@/lib/fiado";
import { useBodegaCore, useMyLoans, useNowSeconds } from "@/lib/bodega/hooks";
import {
  cardClass,
  formatPaymentDate,
  highlightBoxClass,
  mutedTextClass,
  numberInputClass,
  outlineButtonClass,
  primaryButtonClass,
  primaryButtonStyle,
  relativeDays,
  sectionTitleClass,
  statValueClass,
} from "@/lib/bodega/ui";
import { sendAndWait } from "@/lib/smartAccount";
import { withStablecoinApproval } from "@/lib/stablecoin";
import { useExchangeRate } from "@/lib/useExchangeRate";
import type { TabProps } from "./types";

const MAX_SCORE = 1000;

/** Crédito: tu nivel de confianza explicado, el recálculo con IA, el certificado y la línea de crédito. */
export function CreditoTab({ address, client }: TabProps) {
  const core = useBodegaCore(address);
  const { loans, refetch: refetchLoans } = useMyLoans(address);
  const { formatSolesFromUsd, solesToUsd, formatStablecoin, solesToStablecoin } = useExchangeRate();
  const confianza = confianzaLabel(core.score);
  const now = useNowSeconds();

  const [aiResult, setAiResult] = useState<{ recommendation: AiRecommendation; txHash: string | null } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

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

  const certifiedThresholdQuery = useReadContract({
    address: creditCertificateAddress,
    abi: creditCertificateAbi,
    functionName: "getCertifiedThreshold",
    args: [address],
    query: { enabled: Boolean(creditCertificateAddress) },
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

  async function handleAskAi() {
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
      core.refetch();
    } catch {
      setAiError("No pudimos calcular tu fiado ahora mismo. Intenta de nuevo en un momento.");
    } finally {
      setIsAiLoading(false);
    }
  }

  async function handleGenerateCertificate() {
    if (!creditCertificateAddress || !client) return;
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

      await sendAndWait(client, address, [
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
    if (!creditLineAddress || !client || myTierCollateralBps === null) return;
    setIsBorrowing(true);
    setBorrowError(null);
    try {
      const amount = solesToStablecoin(borrowAmountSoles);
      // Misma fórmula que CreditLine.requiredCollateral: se aprueba exactamente esa garantía.
      const collateral = (amount * BigInt(myTierCollateralBps)) / BigInt(10_000);
      const borrow = { address: creditLineAddress, abi: creditLineAbi, functionName: "borrow", args: [amount] };
      await sendAndWait(client, address, collateral > BigInt(0) ? withStablecoinApproval(creditLineAddress, collateral, borrow) : [borrow]);
      refetchLoans();
      core.refetchBalance();
    } catch {
      setBorrowError("No se pudo pedir el préstamo. Revisa que el fondo tenga suficiente disponible.");
    } finally {
      setIsBorrowing(false);
    }
  }

  async function handleRepayLoan(loanId: number, owed: bigint) {
    if (!creditLineAddress || !client) return;
    setRepayingLoanId(loanId);
    setLoanActionError(null);
    try {
      await sendAndWait(
        client,
        address,
        withStablecoinApproval(creditLineAddress, owed, {
          address: creditLineAddress,
          abi: creditLineAbi,
          functionName: "repay",
          args: [BigInt(loanId)],
        }),
      );
      refetchLoans();
      core.refetchBalance();
    } catch {
      setLoanActionError("No se pudo pagar el préstamo. Revisa que tengas saldo suficiente.");
    } finally {
      setRepayingLoanId(null);
    }
  }

  const scorePct = Math.min(100, (core.score / MAX_SCORE) * 100);

  return (
    <div className="flex flex-col gap-6">
      <section id="score" className={cardClass}>
        <h2 className={sectionTitleClass}>Tu nivel de confianza</h2>
        <div className="flex items-baseline justify-between gap-2">
          <p className={`${statValueClass} ${confianza.color}`}>{core.scoreLoading ? "…" : confianza.text}</p>
          <p className="text-sm tabular-nums text-[#6b6d64]">
            {core.scoreLoading ? "…" : core.score} / {MAX_SCORE}
            {core.aiAdjusted ? " · ajustado por IA" : ""}
          </p>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-[#c9e26540]"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={MAX_SCORE}
          aria-valuenow={core.score}
          aria-label="Tu puntaje de confianza"
        >
          <div className="h-full rounded-full bg-[#718817]" style={{ width: `${scorePct}%` }} />
        </div>
        <p className={mutedTextClass}>
          Con este nivel puedes fiar hasta {core.limitLoading ? "…" : formatSolesFromUsd(core.limitUsd)} en total.
        </p>
        <div className={highlightBoxClass}>
          <p className="text-xs font-medium text-[#0a0a0b]">¿Qué sube tu confianza?</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-[#55564f]">
            <li>Cobrar seguido con Bodegueando: ventas frecuentes pesan más que una venta grande.</li>
            <li>Tener movimiento todos los días: si pasan semanas sin ventas, tu nivel baja.</li>
            <li>Que tus clientes te paguen el fiado a tiempo.</li>
          </ul>
        </div>
        <button onClick={handleAskAi} disabled={isAiLoading} className={outlineButtonClass}>
          {isAiLoading ? "Calculando..." : "Revisar mi límite con IA"}
        </button>
        {aiError && <p className="text-xs text-red-500">{aiError}</p>}
        {aiResult && (
          <div className={`${highlightBoxClass} text-sm`}>
            <p className="text-[#0a0a0b]">
              Nuevo límite:{" "}
              <span className="font-medium">{formatSolesFromUsd(Number(aiResult.recommendation.creditLimitWei) / 1e18)}</span> ·
              Riesgo:{" "}
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
      </section>

      {creditCertificateAddress && (
        <section id="certificado" className={cardClass}>
          <h2 className={sectionTitleClass}>Paso 1 · Tu certificado de crédito</h2>
          <p className={mutedTextClass}>
            Demuestra que tu nivel supera un mínimo (por ejemplo &quot;700 o más&quot;) sin mostrar tus ventas ni tu
            puntaje exacto. Un banco o proveedor lo puede validar con un link.
          </p>
          {certifiedThreshold > 0 && (
            <div className={highlightBoxClass}>
              <p className="text-sm text-[#0a0a0b]">✓ Certificado vigente: nivel {certifiedThreshold} o más</p>
              <a href={`/certificado/${address}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#55564f] underline">
                Ver el link para compartir ↗
              </a>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#6b6d64]">Probar que mi nivel es al menos</span>
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
          <button onClick={handleGenerateCertificate} disabled={isGeneratingCertificate || !client} className={primaryButtonClass} style={primaryButtonStyle}>
            {isGeneratingCertificate ? certificateStep ?? "Generando..." : "Generar certificado"}
          </button>
          {certificateError && <p className="text-xs text-red-500">{certificateError}</p>}
          {certificateConfirmed && <p className="text-xs text-green-600">¡Listo! Certificado emitido ✓</p>}
        </section>
      )}

      {creditLineAddress && (
        <section id="prestamo" className={cardClass}>
          <h2 className={sectionTitleClass}>Paso 2 · Pide un préstamo</h2>
          <p className={mutedTextClass}>
            Con tu certificado pides prestado de un fondo compartido. Mientras mejor tu nivel, menos garantía pones.
          </p>
          {tiers.length > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[...tiers].reverse().map((t) => {
                const isMine = myTierCollateralBps === t.collateralBps && certifiedThreshold >= t.minThreshold;
                return (
                  <div key={t.minThreshold} className={`rounded-xl border p-2 ${isMine ? "border-[#718817] bg-[#c9e26526]" : "border-black/10"}`}>
                    <p className="text-[11px] text-[#6b6d64]">Nivel {t.minThreshold}+</p>
                    <p className="text-sm font-semibold text-[#0a0a0b]">{(t.collateralBps / 100).toFixed(0)}% garantía</p>
                  </div>
                );
              })}
            </div>
          )}

          {myTierCollateralBps === null ? (
            <p className="text-xs text-[#8f9189]">Primero genera tu certificado (paso 1) para poder pedir prestado.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-[#6b6d64]">Necesito S/</span>
                <input type="number" inputMode="decimal" min="0" step="10" value={borrowAmountSoles} onChange={(e) => setBorrowAmountSoles(e.target.value)} className={numberInputClass} />
              </div>
              {Number(borrowAmountSoles) > 0 && (
                <div className={highlightBoxClass}>
                  <p className="text-sm text-[#0a0a0b]">
                    Pones de garantía{" "}
                    <span className="font-semibold">
                      {formatSolesFromUsd((solesToUsd(Number(borrowAmountSoles)) * myTierCollateralBps) / 10_000)}
                    </span>{" "}
                    y devuelves{" "}
                    <span className="font-semibold">
                      {formatSolesFromUsd(solesToUsd(Number(borrowAmountSoles)) * (1 + interestBps / 10_000))}
                    </span>{" "}
                    en 30 días.
                  </p>
                  <p className={mutedTextClass}>Incluye {(interestBps / 100).toFixed(0)}% de interés. La garantía vuelve cuando pagas.</p>
                </div>
              )}
              <button onClick={handleBorrow} disabled={isBorrowing || !client} className={outlineButtonClass}>
                {isBorrowing ? "Pidiendo..." : "Pedir préstamo"}
              </button>
              {borrowError && <p className="text-xs text-red-500">{borrowError}</p>}
            </div>
          )}

          {loans.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-[#0a0a0b]">Tus préstamos activos</p>
              {loans.map((loan) => {
                const overdue = loan.dueDate < now;
                return (
                  <div key={loan.id} className={highlightBoxClass}>
                    <p className="text-sm text-[#0a0a0b]">
                      Debes <span className="font-semibold">{formatStablecoin(loan.owed, { withUsd: true })}</span>
                    </p>
                    <p className={`text-xs ${overdue ? "text-amber-700" : "text-[#6b6d64]"}`}>
                      Préstamo de {formatStablecoin(loan.principal)} · garantía {formatStablecoin(loan.collateral)} · vence{" "}
                      {formatPaymentDate(loan.dueDate)} ({relativeDays(loan.dueDate, now)})
                    </p>
                    <button
                      onClick={() => handleRepayLoan(loan.id, loan.owed)}
                      disabled={repayingLoanId === loan.id || !client}
                      className={`${outlineButtonClass} mt-2`}
                    >
                      {repayingLoanId === loan.id ? "Pagando..." : "Pagar préstamo"}
                    </button>
                  </div>
                );
              })}
              {loanActionError && <p className="text-xs text-red-500">{loanActionError}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
