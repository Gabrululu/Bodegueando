import type { Address } from "viem";
import { stablecoinAbi, stablecoinAddress } from "@/lib/contracts";
import type { ContractCall } from "@/lib/smartAccount";

/**
 * Todo contrato que cobra en USDG (PaymentRouter, InvoiceEscrow, GroupOrders, CreditLine) lo
 * jala con transferFrom, así que necesita un approve antes. Va en el mismo UserOperation que
 * la llamada: una sola firma, y si la llamada falla el approve se revierte con ella, así que
 * nunca queda una autorización suelta. Se aprueba el monto exacto, nunca un allowance abierto.
 */
export function withStablecoinApproval(spender: Address, amount: bigint, call: ContractCall): ContractCall[] {
  return [
    {
      address: stablecoinAddress,
      abi: stablecoinAbi,
      functionName: "approve",
      args: [spender, amount],
    },
    call,
  ];
}

/**
 * PUNTOS en formato legible (hasta 2 decimales). Desde que los pagos son en USDG, 1 PUNTO =
 * 1 USD de cashback (18 decimales), así que donde se muestren conviene acompañarlos de su valor
 * en soles con `formatSolesFromUsd(Number(puntos) / 1e18)`.
 */
export function formatPuntos(amount: bigint): string {
  return (Number(amount) / 1e18).toLocaleString("es-PE", { maximumFractionDigits: 2 });
}
