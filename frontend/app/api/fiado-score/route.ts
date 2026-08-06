import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createPublicClient, createWalletClient, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { fiadoScoringAbi, fiadoScoringAddress } from "@/lib/contracts";

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
 */

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
      description: "Recommended fiado credit limit in wei, as a base-10 string (fits uint256).",
    },
    riskLevel: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    rationale: {
      type: "string",
      description: "One or two sentences explaining the recommendation, referencing the payment history.",
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

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: recommendationSchema } },
    system:
      "You are a credit-risk analyst for Bodegueando, a platform giving Lima corner stores " +
      "(bodegas) short-term 'fiado' (store credit) to their customers. You analyze a bodega's " +
      "on-chain payment history — amounts and timestamps of past payments received through the " +
      "platform — and recommend a credit score and a fiado credit limit in wei. Favor consistent, " +
      "frequent, recent payment activity; penalize sparse or old activity. Be conservative with " +
      "credit limits when history is short.",
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

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return NextResponse.json({ error: "Model returned no text content" }, { status: 502 });
  }

  const recommendation = JSON.parse(textBlock.text) as Recommendation;

  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;
  if (!oraclePrivateKey) {
    return NextResponse.json({ recommendation, txHash: null, note: "ORACLE_PRIVATE_KEY not set — recommendation not written on-chain" });
  }

  const account = privateKeyToAccount(oraclePrivateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });

  const txHash = await walletClient.writeContract({
    address: fiadoScoringAddress,
    abi: fiadoScoringAbi,
    functionName: "updateScoreFromAi",
    args: [bodegaAddress as Address, BigInt(recommendation.score), BigInt(recommendation.creditLimitWei)],
  });

  return NextResponse.json({ recommendation, txHash });
}
