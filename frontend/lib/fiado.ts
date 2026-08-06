export interface AiRecommendation {
  score: number;
  creditLimitWei: string;
  riskLevel: "low" | "medium" | "high";
  rationale: string;
}

export const RISK_LABEL: Record<AiRecommendation["riskLevel"], string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
};

export const RISK_COLOR: Record<AiRecommendation["riskLevel"], string> = {
  low: "text-green-600",
  medium: "text-amber-600",
  high: "text-red-600",
};

export function confianzaLabel(score: number): { text: string; color: string } {
  if (score >= 700) return { text: "Alta", color: "text-green-600" };
  if (score >= 300) return { text: "Media", color: "text-amber-600" };
  return { text: "Recién empezando", color: "text-zinc-500" };
}
