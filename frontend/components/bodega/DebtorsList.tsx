"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { signAccountAction } from "@/lib/accountActionMessage";
import { useDebtors } from "@/lib/bodega/activity";
import { cardClass, mutedTextClass, outlineButtonClass, relativeDays, sectionTitleClass } from "@/lib/bodega/ui";
import { useExchangeRate } from "@/lib/useExchangeRate";
import type { TabProps } from "./types";

const REMIND_RESULT: Record<string, string> = {
  sent: "Recordatorio enviado por Telegram ✓",
  not_linked: "Este cliente no vinculó Telegram — recuérdale en persona.",
  already_reminded_today: "Ya le recordaste hoy. Mañana puedes volver a hacerlo.",
  no_debt: "Ya no te debe nada.",
};

/**
 * "Quién te debe": clientes con deuda de fiado pendiente, armado desde los eventos on-chain
 * (FiadoExtended/FiadoRepaid) con la deuda actual leída del contrato. Cada cliente se muestra por
 * su código de 6 dígitos — el mismo con el que la bodega le fió —, nunca por su dirección.
 */
export function DebtorsList({ address, signAsOwner }: { address: Address; signAsOwner: TabProps["signAsOwner"] }) {
  const debtors = useDebtors(address);
  const { formatSolesFromUsd } = useExchangeRate();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [remindingKey, setRemindingKey] = useState<string | null>(null);
  const [remindResult, setRemindResult] = useState<Record<string, string>>({});

  const customers = (debtors.data ?? []).map((d) => d.customer.toLowerCase());

  useEffect(() => {
    const missing = customers.filter((c) => !(c in codes));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((customer) =>
        fetch("/api/bodega/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: customer, pool: "buyer" }),
        })
          .then((res) => res.json())
          .then((data) => [customer, (data.code as string) ?? "?"] as const)
          .catch(() => [customer, "?"] as const),
      ),
    ).then((pairs) => setCodes((prev) => ({ ...prev, ...Object.fromEntries(pairs) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers.join(",")]);

  async function handleRemind(customer: Address) {
    if (!signAsOwner) return;
    const key = customer.toLowerCase();
    setRemindingKey(key);
    try {
      // Solo la dueña puede mandar el recordatorio: firma para este cliente en particular.
      const { issuedAt, signature } = await signAccountAction(signAsOwner, "fiado-remind", address, { cliente: key });
      const res = await fetch("/api/fiado/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodega: address, customer, issuedAt, signature }),
      });
      const data = await res.json();
      const outcome = data.sent ? "sent" : (data.reason as string);
      setRemindResult((prev) => ({ ...prev, [key]: REMIND_RESULT[outcome] ?? "No se pudo enviar. Intenta de nuevo." }));
    } catch {
      setRemindResult((prev) => ({ ...prev, [key]: "No se pudo enviar. Intenta de nuevo." }));
    } finally {
      setRemindingKey(null);
    }
  }

  const list = debtors.data ?? [];
  const totalUsd = list.reduce((sum, d) => sum + d.debtUsd, 0);

  return (
    <section id="deudores" className={cardClass}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={sectionTitleClass}>Quién te debe</h2>
        {list.length > 0 && <span className="text-sm font-semibold text-[#0a0a0b]">{formatSolesFromUsd(totalUsd)}</span>}
      </div>
      {debtors.isLoading ? (
        <p className={mutedTextClass}>Revisando tu libro de fiado…</p>
      ) : debtors.isError ? (
        <p className="text-xs text-red-500">No pudimos leer tu libro de fiado ahora mismo. Intenta en un momento.</p>
      ) : list.length === 0 ? (
        <p className={mutedTextClass}>Nadie te debe nada ahora mismo. 🎉</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/10">
          {list.map((d) => {
            const key = d.customer.toLowerCase();
            return (
              <li key={key} className="flex flex-col gap-2 bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#0a0a0b]">Cliente #{codes[key] ?? "…"}</p>
                    <p className={mutedTextClass}>
                      {d.lastRepayment ? `Último pago ${relativeDays(d.lastRepayment)}` : "Todavía no pagó nada"}
                    </p>
                  </div>
                  <span className="text-base font-semibold tabular-nums text-[#0a0a0b]">{formatSolesFromUsd(d.debtUsd)}</span>
                </div>
                <button
                  onClick={() => handleRemind(d.customer)}
                  disabled={remindingKey === key || !signAsOwner}
                  className={`${outlineButtonClass} min-h-9 self-start py-1 text-xs`}
                >
                  {remindingKey === key ? "Enviando..." : "Recordarle por Telegram"}
                </button>
                {remindResult[key] && <p className={mutedTextClass}>{remindResult[key]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
