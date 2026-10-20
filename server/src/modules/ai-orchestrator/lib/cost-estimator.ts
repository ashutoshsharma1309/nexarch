/**
 * Turns token counts into a USD figure using the price published for the
 * model that actually ran — or reports that there is no figure to give.
 *
 * This used to multiply tokens by `provider.costPerMillionInputTokens`, a
 * flat rate hung on the provider object, and ignored the `model` argument
 * entirely. So every Groq call was billed at the `gpt-oss-120b` rate,
 * including `openai/gpt-oss-20b` calls (half that) and vision calls to
 * `qwen/qwen3.8-27b` (6.7x it on output): the cost column in the UI and the
 * totals in `/ai/statistics` were wrong by whatever ratio happened to
 * apply, and never visibly so. Pricing by model id is the fix.
 *
 * When the model has no published price, the three dollar fields are `null`
 * and `pricing` carries the reason. A figure interpolated from some other
 * model's rate reads exactly like a measured one by the time it reaches a
 * screen, and this codebase does not report what it cannot evidence.
 */
import type { CostEstimate, ModelProvider, ModelUsage } from '../ai-orchestrator.types.js';
import { lookupModelPrice } from './model-pricing.js';

/**
 * What a call cost, priced by the model that actually ran.
 *
 * `provider` no longer supplies the rate — it only stamps the estimate with
 * which adapter made the call, so a record still says where the work went.
 */
export function estimateCost(
  provider: ModelProvider,
  model: string,
  usage: ModelUsage,
): CostEstimate {
  const price = lookupModelPrice(model);

  if (price === null) {
    // Zero tokens would multiply out to zero at any rate, but answering $0
    // for an unpriced model asserts the model is free rather than
    // unmeasured — and the next call, with real tokens, would be a lie.
    return {
      provider: provider.id,
      model,
      inputCostUsd: null,
      outputCostUsd: null,
      totalCostUsd: null,
      pricing: {
        known: false,
        reason: `No published price recorded for model "${model}" in lib/model-pricing.ts`,
      },
    };
  }

  const inputCostUsd = (usage.inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * price.outputPerMillion;

  return {
    provider: provider.id,
    model,
    inputCostUsd: round(inputCostUsd),
    outputCostUsd: round(outputCostUsd),
    totalCostUsd: round(inputCostUsd + outputCostUsd),
    pricing: { known: true, source: price.source },
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
