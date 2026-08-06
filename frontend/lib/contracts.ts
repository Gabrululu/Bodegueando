import PaymentRouterArtifact from "./abis/PaymentRouter.json";
import PuntosTokenArtifact from "./abis/PuntosToken.json";
import FiadoScoringArtifact from "./abis/FiadoScoring.json";

/**
 * Contract addresses come from env vars, filled in after deploying with
 * `forge script script/Deploy.s.sol` (Solidity side) and `cargo stylus deploy`
 * (FiadoScoring). See root README for the deploy steps.
 *
 * ABI JSON files under ./abis are placeholders checked in so the frontend type-checks
 * before a deploy exists. Regenerate them for real ABIs with:
 *   forge inspect PaymentRouter abi > frontend/lib/abis/PaymentRouter.json
 *   forge inspect PuntosToken abi > frontend/lib/abis/PuntosToken.json
 *   cargo stylus export-abi --json > frontend/lib/abis/FiadoScoring.json   (from contracts/stylus-fiado-scoring)
 */
export const paymentRouterAddress = process.env
  .NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS as `0x${string}` | undefined;
export const puntosTokenAddress = process.env
  .NEXT_PUBLIC_PUNTOS_TOKEN_ADDRESS as `0x${string}` | undefined;
export const fiadoScoringAddress = process.env
  .NEXT_PUBLIC_FIADO_SCORING_ADDRESS as `0x${string}` | undefined;

export const paymentRouterAbi = PaymentRouterArtifact.abi;
export const puntosTokenAbi = PuntosTokenArtifact.abi;
export const fiadoScoringAbi = FiadoScoringArtifact.abi;
