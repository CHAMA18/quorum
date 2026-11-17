/**
 * Model cost per run, computed from the endpoint's own measured token counts.
 *
 * Prices are Cloudflare Workers AI list prices for the hosted Kira model
 * (Llama 3.2 3B instruct): $0.0509 per million input tokens, $0.335 per
 * million output tokens (checked 2026-11-17; see SUBMISSION/NAIROBI-FACT-SHEET.md).
 * The in-region (local Ollama) path has $0 marginal cost, so figures are
 * always labelled "at hosted list prices" — token counts are the auditable
 * input, price × tokens is the derivation, never a guessed bill.
 */
import type { ModelUsage } from "./kira";

export const MODEL_PRICE_USD_PER_MILLION = {
  input: 0.0509,
  output: 0.335,
} as const;

/** USD for a measured usage record, from prompt + completion tokens. */
export function modelCostUsd(usage: Pick<ModelUsage, "promptTokens" | "completionTokens">): number {
  const prompt = Math.max(0, usage.promptTokens);
  const completion = Math.max(0, usage.completionTokens);
  return (prompt * MODEL_PRICE_USD_PER_MILLION.input + completion * MODEL_PRICE_USD_PER_MILLION.output) / 1_000_000;
}

/** "≈ $0.0012" — per-run costs are sub-cent, so four decimals keep them readable. */
export function fmtModelCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `≈ $${usd.toFixed(4)}`;
  return `≈ $${usd.toFixed(2)}`;
}

/** Full label for inline usage lines. */
export function modelCostLabel(usage: Pick<ModelUsage, "promptTokens" | "completionTokens">): string {
  return `${fmtModelCost(modelCostUsd(usage))} at hosted list prices`;
}
