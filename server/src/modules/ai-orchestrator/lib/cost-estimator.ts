/** Turns token counts into a USD estimate using each provider's own advertised per-million-token rate — no per-provider branching, just the rate the provider instance already carries. */
import type { CostEstimate, ModelProvider, ModelUsage } from '../ai-orchestrator.types.js';

export function estimateCost(
  provider: ModelProvider,
  model: string,
  usage: ModelUsage,
): CostEstimate {
  const inputCostUsd = (usage.inputTokens / 1_000_000) * provider.costPerMillionInputTokens;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * provider.costPerMillionOutputTokens;

  return {
    provider: provider.id,
    model,
    inputCostUsd: round(inputCostUsd),
    outputCostUsd: round(outputCostUsd),
    totalCostUsd: round(inputCostUsd + outputCostUsd),
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
