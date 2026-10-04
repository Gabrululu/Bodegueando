import { erc20Abi, getAddress, isAddress, type Abi } from "viem";
import PaymentRouterArtifact from "./abis/PaymentRouter.json";
import PuntosTokenArtifact from "./abis/PuntosToken.json";
import FiadoScoringArtifact from "./abis/FiadoScoring.json";
import BeneficioTokenArtifact from "./abis/BeneficioToken.json";
import InvoiceEscrowArtifact from "./abis/InvoiceEscrow.json";
import RewardsCatalogArtifact from "./abis/RewardsCatalog.json";
import GroupOrdersArtifact from "./abis/GroupOrders.json";
import CreditCertificateArtifact from "./abis/CreditCertificate.json";
import CreditLineArtifact from "./abis/CreditLine.json";

/**
 * Contract addresses come from env vars, filled in after deploying with
 * `forge script script/Deploy.s.sol` (Solidity side) and `cargo stylus deploy`
 * (FiadoScoring). See root README for the deploy steps.
 *
 * ABI JSON files under ./abis are placeholders checked in so the frontend type-checks
 * before a deploy exists. Regenerate them for real ABIs with:
 *   forge inspect PaymentRouter abi > frontend/lib/abis/PaymentRouter.json
 *   forge inspect PuntosToken abi > frontend/lib/abis/PuntosToken.json
 *   forge inspect InvoiceEscrow abi --json > frontend/lib/abis/InvoiceEscrow.json (wrap in {"abi": [...]})
 *   cargo stylus export-abi --json > frontend/lib/abis/FiadoScoring.json   (from contracts/stylus-fiado-scoring)
 */
/**
 * Lee una dirección de una variable de entorno: le quita espacios/tabs (es fácil pegarlos al
 * copiar en el panel de Vercel, y viem rechaza la dirección entera por eso) y la valida. Si no es
 * una dirección válida, avisa en la consola nombrando la variable y la trata como no configurada,
 * en vez de fallar más tarde con un error difícil de rastrear.
 */
function envAddress(name: string, raw: string | undefined): `0x${string}` | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) {
    console.error(`[config] ${name} no es una dirección válida: "${raw}"`);
    return undefined;
  }
  return getAddress(value);
}

// Cada `process.env.NEXT_PUBLIC_...` va escrito literal: Next.js los reemplaza al compilar.
export const paymentRouterAddress = envAddress("NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS", process.env.NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS);
export const puntosTokenAddress = envAddress("NEXT_PUBLIC_PUNTOS_TOKEN_ADDRESS", process.env.NEXT_PUBLIC_PUNTOS_TOKEN_ADDRESS);
export const fiadoScoringAddress = envAddress("NEXT_PUBLIC_FIADO_SCORING_ADDRESS", process.env.NEXT_PUBLIC_FIADO_SCORING_ADDRESS);
export const beneficioTokenAddress = envAddress("NEXT_PUBLIC_BENEFICIO_TOKEN_ADDRESS", process.env.NEXT_PUBLIC_BENEFICIO_TOKEN_ADDRESS);
export const invoiceEscrowAddress = envAddress("NEXT_PUBLIC_INVOICE_ESCROW_ADDRESS", process.env.NEXT_PUBLIC_INVOICE_ESCROW_ADDRESS);
export const rewardsCatalogAddress = envAddress("NEXT_PUBLIC_REWARDS_CATALOG_ADDRESS", process.env.NEXT_PUBLIC_REWARDS_CATALOG_ADDRESS);
export const groupOrdersAddress = envAddress("NEXT_PUBLIC_GROUP_ORDERS_ADDRESS", process.env.NEXT_PUBLIC_GROUP_ORDERS_ADDRESS);
export const creditCertificateAddress = envAddress("NEXT_PUBLIC_CREDIT_CERTIFICATE_ADDRESS", process.env.NEXT_PUBLIC_CREDIT_CERTIFICATE_ADDRESS);
export const creditLineAddress = envAddress("NEXT_PUBLIC_CREDIT_LINE_ADDRESS", process.env.NEXT_PUBLIC_CREDIT_LINE_ADDRESS);
export const puntosPaymasterAddress = envAddress("NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS", process.env.NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS);

/**
 * Stablecoin que PaymentRouter usa para cobrar: Paxos USDG (6 decimales, 1 USDG = 1 USD).
 * Por defecto apunta a USDG en Arbitrum Sepolia (docs.paxos.com/guides/stablecoin/usdg/testnet).
 * Los montos que PaymentRouter le pasa a PuntosToken y FiadoScoring (cashback, límites y deuda
 * de fiado) están normalizados a 18 decimales, en USD — ver PaymentRouter.sol.
 */
export const stablecoinAddress =
  envAddress("NEXT_PUBLIC_STABLECOIN_ADDRESS", process.env.NEXT_PUBLIC_STABLECOIN_ADDRESS) ??
  "0xFFC95faa3d63Cde504a05B567C600B78C0b41892";
export const STABLECOIN_DECIMALS = 6;
export const stablecoinAbi = erc20Abi;

export const paymentRouterAbi = PaymentRouterArtifact.abi;
export const puntosTokenAbi = PuntosTokenArtifact.abi;
export const fiadoScoringAbi = FiadoScoringArtifact.abi;
export const beneficioTokenAbi = BeneficioTokenArtifact.abi;
// Cast to Abi: useReadContracts (used for the invoice/reward/group-order lists in
// BodegaOwnerPanel/BuyerPanel) needs each contract entry's abi to satisfy viem's Abi type,
// which the plain JSON import's widened string-literal types (e.g. `type: string` instead of
// `type: "function"`) don't.
export const invoiceEscrowAbi = InvoiceEscrowArtifact.abi as Abi;
export const rewardsCatalogAbi = RewardsCatalogArtifact.abi as Abi;
export const groupOrdersAbi = GroupOrdersArtifact.abi as Abi;
export const creditCertificateAbi = CreditCertificateArtifact.abi as Abi;
export const creditLineAbi = CreditLineArtifact.abi as Abi;
