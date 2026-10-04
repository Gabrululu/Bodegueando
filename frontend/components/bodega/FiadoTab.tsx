"use client";

import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { fiadoScoringAbi, fiadoScoringAddress, invoiceEscrowAbi, invoiceEscrowAddress } from "@/lib/contracts";
import { confianzaLabel } from "@/lib/fiado";
import { INVOICE_STATUS, INVOICE_STATUS_LABEL, useBodegaCore, useMyInvoices, useNowSeconds } from "@/lib/bodega/hooks";
import {
  cardClass,
  formatPaymentDate,
  highlightBoxClass,
  inputClass,
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
import { useExchangeRate } from "@/lib/useExchangeRate";
import { DebtorsList } from "./DebtorsList";
import type { TabProps } from "./types";

/** Fiado: prenderlo/apagarlo, cuánto ya fiaste, quién te debe, fiar a un cliente y fiado con garantía. */
export function FiadoTab({ address, client, navigate }: TabProps) {
  const core = useBodegaCore(address);
  const { invoices, refetch: refetchInvoices } = useMyInvoices(address);
  const { formatSolesFromUsd, solesToUsd, formatStablecoin, solesToStablecoin } = useExchangeRate();
  const queryClient = useQueryClient();
  const confianza = confianzaLabel(core.score);
  const now = useNowSeconds();

  const [isTogglePending, setIsTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

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

  const refreshFiado = () => {
    core.refetch();
    queryClient.invalidateQueries({ queryKey: ["bodega-debtors"] });
  };

  const isValidCustomerCodeFormat = /^\d{6,9}$/.test(customerCodeInput.trim());

  useEffect(() => {
    if (!isValidCustomerCodeFormat) return;
    const code = customerCodeInput.trim();
    let cancelled = false;
    (async () => {
      setIsResolvingCustomer(true);
      setCustomerNotFound(false);
      try {
        const res = await fetch(`/api/bodega/code?code=${code}&pool=buyer`);
        const data = await res.json();
        if (cancelled) return;
        setCustomerAddress(data.address ? (data.address as Address) : undefined);
        setCustomerNotFound(!data.address);
      } catch {
        if (!cancelled) {
          setCustomerAddress(undefined);
          setCustomerNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolvingCustomer(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerCodeInput, isValidCustomerCodeFormat]);

  function handleCustomerCodeChange(value: string) {
    const trimmed = value.trim();
    setCustomerCodeInput(trimmed);
    if (!/^\d{6,9}$/.test(trimmed)) {
      setCustomerAddress(undefined);
      setCustomerNotFound(false);
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!fiadoScoringAddress || !client) return;
    setIsTogglePending(true);
    setToggleError(null);
    try {
      await sendAndWait(client, address, [
        { address: fiadoScoringAddress, abi: fiadoScoringAbi, functionName: "setFiadoEnabled", args: [enabled] },
      ]);
      core.refetch();
    } catch {
      setToggleError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setIsTogglePending(false);
    }
  }

  async function handleFiar() {
    if (!customerAddress || !fiadoScoringAddress || !client) return;
    setIsFiarSubmitting(true);
    setFiarError(null);
    setFiarConfirmed(false);
    try {
      // FiadoScoring lleva la deuda en USD con 18 decimales.
      const usdAmount = solesToUsd(Number(fiarAmountSoles || "0"));
      await sendAndWait(client, address, [
        {
          address: fiadoScoringAddress,
          abi: fiadoScoringAbi,
          functionName: "extendFiado",
          args: [customerAddress, parseEther(usdAmount.toFixed(18))],
        },
      ]);
      setFiarConfirmed(true);
      setCustomerCodeInput("");
      setCustomerAddress(undefined);
      refreshFiado();
    } catch {
      setFiarError("No se pudo registrar el fiado. Revisa que tengas espacio disponible para fiar esa cantidad.");
    } finally {
      setIsFiarSubmitting(false);
    }
  }

  async function handleProposeInvoice() {
    if (!customerAddress || !invoiceEscrowAddress || !client) return;
    setIsProposing(true);
    setProposeError(null);
    setProposeConfirmed(false);
    try {
      const principal = solesToStablecoin(escrowPrincipalSoles);
      const collateral = solesToStablecoin(escrowCollateralSoles);
      const dueDate = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(Number(escrowDueDays || "0"))) * 86400);
      await sendAndWait(client, address, [
        {
          address: invoiceEscrowAddress,
          abi: invoiceEscrowAbi,
          functionName: "proposeInvoice",
          args: [customerAddress, principal, collateral, dueDate],
        },
      ]);
      setProposeConfirmed(true);
      refetchInvoices();
    } catch {
      setProposeError("No se pudo proponer el fiado con garantía. Intenta de nuevo.");
    } finally {
      setIsProposing(false);
    }
  }

  async function handleClaimCollateral(id: number) {
    if (!invoiceEscrowAddress || !client) return;
    setClaimingInvoiceId(id);
    setClaimError(null);
    try {
      await sendAndWait(client, address, [
        { address: invoiceEscrowAddress, abi: invoiceEscrowAbi, functionName: "claimCollateral", args: [BigInt(id)] },
      ]);
      refetchInvoices();
      refreshFiado();
    } catch {
      setClaimError("No se pudo reclamar la garantía. Revisa que ya haya vencido el plazo.");
    } finally {
      setClaimingInvoiceId(null);
    }
  }

  const usedPct = core.limitUsd > 0 ? Math.min(100, (core.outstandingUsd / core.limitUsd) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <section id="fiado" className={cardClass}>
        <h2 className={sectionTitleClass}>Fiado para tus clientes</h2>
        <p className={mutedTextClass}>Tú decides si le fías a tus clientes. Puedes prenderlo o apagarlo cuando quieras.</p>
        <button
          onClick={() => handleToggle(!core.fiadoEnabled)}
          disabled={isTogglePending || core.fiadoEnabledLoading || !client}
          className={primaryButtonClass}
          style={primaryButtonStyle}
        >
          {isTogglePending ? "Guardando..." : core.fiadoEnabled ? "Fiado activado — desactivar" : "Activar fiado para mis clientes"}
        </button>
        {toggleError && <p className="text-xs text-red-500">{toggleError}</p>}

        {core.fiadoEnabled && (
          <div className={highlightBoxClass}>
            <div className="flex items-baseline justify-between gap-2">
              <p className={mutedTextClass}>Ya fiaste</p>
              <p className={mutedTextClass}>Tu límite: {core.limitLoading ? "…" : formatSolesFromUsd(core.limitUsd)}</p>
            </div>
            <p className={statValueClass}>{core.outstandingLoading ? "…" : formatSolesFromUsd(core.outstandingUsd)}</p>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#c9e26540]"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(usedPct)}
              aria-label="Parte de tu límite de fiado que ya usaste"
            >
              <div
                className={`h-full rounded-full ${usedPct >= 90 ? "bg-amber-500" : "bg-[#718817]"}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className={`mt-2 ${mutedTextClass}`}>
              Te queda {core.availableLoading ? "…" : formatSolesFromUsd(core.availableUsd)} para fiar · Confianza{" "}
              <span className={`font-medium ${confianza.color}`}>{confianza.text}</span>
            </p>
            <button
              type="button"
              onClick={() => navigate("credito", "score")}
              className="mt-1 cursor-pointer text-xs font-medium text-[#55564f] underline underline-offset-2"
            >
              ¿Cómo subir mi límite? →
            </button>
          </div>
        )}
      </section>

      {core.fiadoEnabled && <DebtorsList address={address} />}

      {core.fiadoEnabled && (
        <section id="fiar" className={cardClass}>
          <h2 className={sectionTitleClass}>Fiar a un cliente</h2>
          <label htmlFor="customerCode" className={mutedTextClass}>
            Pídele su código (lo ve en su app, en &quot;Tu código para que te fíen&quot;).
          </label>
          <input
            id="customerCode"
            inputMode="numeric"
            value={customerCodeInput}
            onChange={(e) => handleCustomerCodeChange(e.target.value)}
            placeholder="El código de tu cliente"
            className={inputClass}
          />
          {isResolvingCustomer && <p className={mutedTextClass}>Buscando...</p>}
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
                  className={numberInputClass}
                />
              </div>
              <button onClick={handleFiar} disabled={isFiarSubmitting || !client} className={primaryButtonClass} style={primaryButtonStyle}>
                {isFiarSubmitting ? "Fiando..." : "Fiar sin garantía"}
              </button>

              {invoiceEscrowAddress && (
                <details className="rounded-xl border border-black/10 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-[#0a0a0b]">
                    ¿Monto grande? Pide una garantía
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    <p className={mutedTextClass}>
                      Tu cliente deposita una parte como garantía. Si no te paga antes del vencimiento, te quedas con ese
                      depósito.
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-sm text-[#6b6d64]">Monto S/</span>
                      <input type="number" inputMode="decimal" min="0" step="1" value={escrowPrincipalSoles} onChange={(e) => setEscrowPrincipalSoles(e.target.value)} className={numberInputClass} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-sm text-[#6b6d64]">Garantía S/</span>
                      <input type="number" inputMode="decimal" min="0" step="1" value={escrowCollateralSoles} onChange={(e) => setEscrowCollateralSoles(e.target.value)} className={numberInputClass} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-sm text-[#6b6d64]">Vence en (días)</span>
                      <input type="number" inputMode="numeric" min="1" step="1" value={escrowDueDays} onChange={(e) => setEscrowDueDays(e.target.value)} className={numberInputClass} />
                    </div>
                    <button onClick={handleProposeInvoice} disabled={isProposing || !client} className={outlineButtonClass}>
                      {isProposing ? "Proponiendo..." : "Proponer fiado con garantía"}
                    </button>
                    {proposeError && <p className="text-xs text-red-500">{proposeError}</p>}
                    {proposeConfirmed && (
                      <p className="text-xs text-green-600">¡Listo! El cliente ya puede aceptarla y depositar la garantía ✓</p>
                    )}
                  </div>
                </details>
              )}
            </>
          )}
          {fiarError && <p className="text-xs text-red-500">{fiarError}</p>}
          {fiarConfirmed && <p className="text-xs text-green-600">¡Listo! Ya quedó registrado el fiado ✓</p>}
        </section>
      )}

      {invoiceEscrowAddress && invoices.length > 0 && (
        <section id="facturas" className={cardClass}>
          <h2 className={sectionTitleClass}>Fiado con garantía</h2>
          {invoices.map((inv) => {
            const overdue = inv.status === INVOICE_STATUS.Active && inv.dueDate < now;
            return (
              <div key={inv.id} className={highlightBoxClass}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[#0a0a0b]">{formatStablecoin(inv.principal)}</p>
                  <span className={`text-xs font-medium ${overdue ? "text-amber-700" : "text-[#6b6d64]"}`}>
                    {overdue ? "⚠ Vencida" : INVOICE_STATUS_LABEL[inv.status]}
                  </span>
                </div>
                <p className={mutedTextClass}>
                  Garantía {formatStablecoin(inv.collateral)} · pagado {formatStablecoin(inv.repaidAmount)} · vence{" "}
                  {formatPaymentDate(inv.dueDate)} ({relativeDays(inv.dueDate, now)})
                </p>
                {overdue && (
                  <button
                    onClick={() => handleClaimCollateral(inv.id)}
                    disabled={claimingInvoiceId === inv.id || !client}
                    className={`${outlineButtonClass} mt-2`}
                  >
                    {claimingInvoiceId === inv.id ? "Reclamando..." : "Reclamar la garantía"}
                  </button>
                )}
              </div>
            );
          })}
          {claimError && <p className="text-xs text-red-500">{claimError}</p>}
        </section>
      )}
    </div>
  );
}
