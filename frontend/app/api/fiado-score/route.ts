import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { fiadoScoringAbi, fiadoScoringAddress } from "@/lib/contracts";
import { accountActionMessage } from "@/lib/accountActionMessage";
import { verifyBodegaOwner } from "@/lib/ownerAuth";
import { hitRateLimit } from "@/lib/rateLimit";

/**
 * Reads a bodega's on-chain payment history from the FiadoScoring (Stylus) contract,
 * asks Claude for a credit score/limit recommendation grounded in that history, and
 * writes the recommendation back on-chain via updateScoreFromAi. This is the core
 * "AI adjusts the on-chain credit line" flow for the hackathon demo — not a stub.
 *
 * Requires (see .env.example): ANTHROPIC_API_KEY, ORACLE_PRIVATE_KEY (testnet-only key
 * authorized as the FiadoScoring ai_oracle — a server-held key is a hackathon-speed
 * shortcut vs. a proper signer service, documented in the README), and
 * NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL / NEXT_PUBLIC_FIADO_SCORING_ADDRESS.
 *
 * Each call costs a Claude request and an oracle transaction, so it requires the bodega owner's
 * signature (lib/ownerAuth.ts) and is rate limited: a few recalculations per bodega per day, plus
 * a global daily cap (FIADO_SCORE_DAILY_LIMIT) that bounds the total cost even across many bodegas.
 */
const PER_BODEGA_DAILY_LIMIT = 3;
const GLOBAL_DAILY_LIMIT = Number(process.env.FIADO_SCORE_DAILY_LIMIT) || 200;
const DAY_SECONDS = 24 * 60 * 60;

const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});

const recommendationSchema = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Overall creditworthiness score from 0 (highest risk) to 1000 (lowest risk).",
    },
    creditLimitWei: {
      type: "string",
      description: "Recommended fiado credit limit in USD with 18 decimals (1 USD = 10^18), as a base-10 string (fits uint256).",
    },
    riskLevel: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    rationale: {
      type: "string",
      description:
        "One or two SHORT sentences in simple Peruvian Spanish (as if explaining to a bodega " +
        "owner with no financial or technical background), referencing the payment history. " +
        "No blockchain/technical jargon (never say 'on-chain', 'blockchain', 'wallet', 'smart " +
        "contract', 'wei', etc.) — just plain talk about payments and confianza.",
    },
  },
  required: ["score", "creditLimitWei", "riskLevel", "rationale"],
  additionalProperties: false,
} as const;

interface Recommendation {
  score: number;
  creditLimitWei: string;
  riskLevel: "low" | "medium" | "high";
  rationale: string;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodegaAddress = body?.bodegaAddress;

  if (typeof bodegaAddress !== "string" || !isAddress(bodegaAddress)) {
    return NextResponse.json({ error: "bodegaAddress must be a valid address" }, { status: 400 });
  }
  const signature = body?.signature;
  const issuedAt = Number(body?.issuedAt);
  if (typeof signature !== "string" || !isHex(signature)) {
    return NextResponse.json({ error: "signature is required" }, { status: 400 });
  }

  const auth = await verifyBodegaOwner({
    bodega: bodegaAddress as Address,
    message: accountActionMessage("fiado-score", bodegaAddress, issuedAt),
    signature: signature as Hex,
    issuedAt,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: "Could not verify the bodega owner", reason: auth.reason }, { status: auth.status });
  }

  if (await hitRateLimit(`fiado-score:${bodegaAddress.toLowerCase()}`, PER_BODEGA_DAILY_LIMIT, DAY_SECONDS)) {
    return NextResponse.json({ error: "Too many recalculations for this bodega today", reason: "rate_limited" }, { status: 429 });
  }
  if (await hitRateLimit("fiado-score:global", GLOBAL_DAILY_LIMIT, DAY_SECONDS)) {
    return NextResponse.json({ error: "Daily recalculation budget reached", reason: "rate_limited" }, { status: 429 });
  }

  if (!fiadoScoringAddress) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_FIADO_SCORING_ADDRESS is not configured — deploy FiadoScoring first" },
      { status: 503 },
    );
  }

  const [currentScore, currentLimit, [amounts, timestamps]] = await Promise.all([
    publicClient.readContract({
      address: fiadoScoringAddress,
      abi: fiadoScoringAbi,
      functionName: "getScore",
      args: [bodegaAddress as Address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: fiadoScoringAddress,
      abi: fiadoScoringAbi,
      functionName: "getCreditLimit",
      args: [bodegaAddress as Address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: fiadoScoringAddress,
      abi: fiadoScoringAbi,
      functionName: "getPaymentHistory",
      args: [bodegaAddress as Address],
    }) as Promise<[bigint[], bigint[]]>,
  ]);

  const history = amounts.map((amount, i) => ({
    amountWei: amount.toString(),
    timestamp: Number(timestamps[i]),
  }));

  const anthropic = new Anthropic();

  // Cada fallo devuelve un JSON con `reason` en vez de un 500 vacío: antes un error de la API,
  // una respuesta cortada o un revert on-chain eran indistinguibles desde afuera.
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: "claude-opus-5",
      // Thinking está activo por defecto en este modelo y cuenta dentro de max_tokens: con 1024
      // el JSON podía quedar cortado. 16000 es holgado para una respuesta corta.
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: recommendationSchema } },
      system:
        "You are a credit-risk analyst for Bodegueando, a platform giving Lima corner stores " +
        "(bodegas) short-term 'fiado' (store credit) to their customers. You analyze a bodega's " +
        "on-chain payment history — amounts and timestamps of past payments received through the " +
        "platform — and recommend a credit score and a fiado credit limit. All amounts (payments and " +
        "limits) are US dollars with 18 decimals, i.e. 10^18 = 1 USD (payments settle in the USDG " +
        "stablecoin). Favor consistent, " +
        "frequent, recent payment activity; penalize sparse or old activity. Be conservative with " +
        "credit limits when history is short. IMPORTANT: the `rationale` field is shown directly " +
        "to end users who are not technical and may not be fluent in English — it must always be " +
        "written in simple, everyday Peruvian Spanish, never in English, and never using " +
        "blockchain/technical terms. `score` and `creditLimitWei` stay numeric as specified by the " +
        "schema; only `rationale` is the plain-Spanish explanation. The contract rejects any limit " +
        "above twice what its own on-chain heuristic justifies, so never recommend more than twice " +
        "`currentOnChainCreditLimitWei`.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            bodega: bodegaAddress,
            currentOnChainScore: currentScore.toString(),
            currentOnChainCreditLimitWei: currentLimit.toString(),
            paymentHistory: history,
            nowUnix: Math.floor(Date.now() / 1000),
          }),
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("[fiado-score] Anthropic auth failed — check ANTHROPIC_API_KEY", err.message);
      return NextResponse.json({ error: "AI provider authentication failed", reason: "ai_auth" }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "AI provider rate limited, retry later", reason: "ai_rate_limited" }, { status: 503 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[fiado-score] Anthropic API error", err.status, err.message);
      return NextResponse.json({ error: `AI provider error ${err.status}`, reason: "ai_api_error" }, { status: 502 });
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    return NextResponse.json({ error: "The model declined this request", reason: "ai_refusal" }, { status: 502 });
  }
  if (response.stop_reason === "max_tokens") {
    return NextResponse.json({ error: "The model's answer was cut off", reason: "ai_truncated" }, { status: 502 });
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return NextResponse.json({ error: "Model returned no text content", reason: "ai_no_text" }, { status: 502 });
  }

  let recommendation: Recommendation;
  try {
    recommendation = JSON.parse(textBlock.text) as Recommendation;
  } catch {
    return NextResponse.json({ error: "Model returned invalid JSON", reason: "ai_invalid_json" }, { status: 502 });
  }
  if (
    !Number.isInteger(recommendation.score) ||
    recommendation.score < 0 ||
    recommendation.score > 1000 ||
    !/^\d+$/.test(recommendation.creditLimitWei)
  ) {
    return NextResponse.json({ error: "Model returned out-of-range values", reason: "ai_invalid_values" }, { status: 502 });
  }

  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;
  if (!oraclePrivateKey) {
    return NextResponse.json({ recommendation, txHash: null, note: "ORACLE_PRIVATE_KEY not set — recommendation not written on-chain" });
  }

  const account = privateKeyToAccount(oraclePrivateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });

  const write = {
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "updateScoreFromAi",
    args: [bodegaAddress as Address, BigInt(recommendation.score), BigInt(recommendation.creditLimitWei)],
  } as const;

  // Simular primero: si el circuit breaker de FiadoScoring rechaza el límite (más del doble de
  // lo que justifica el historial real), se explica en vez de reventar con un 500.
  try {
    await publicClient.simulateContract({ ...write, account });
  } catch (err) {
    const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    console.error("[fiado-score] updateScoreFromAi would revert", revert ?? err);
    return NextResponse.json(
      {
        recommendation,
        txHash: null,
        reason: "onchain_rejected",
        error: "El contrato no aceptó este límite (supera lo que justifica tu historial). No se aplicó.",
      },
      { status: 422 },
    );
  }

  const txHash = await walletClient.writeContract(write);
  return NextResponse.json({ recommendation, txHash });
}
