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
  // Multiplying a token count the provider never reported gives $0, which
  // would read as a free call.
  if (usage.unreported !== undefined && usage.unreported.length > 0) {
    return {
      provider: provider.id,
      model,
      inputCostUsd: null,
      outputCostUsd: null,
      totalCostUsd: null,
      pricing: {
        known: false,
        reason: `The provider did not report ${usage.unreported.join(' and ')} token usage for this call`,
      },
    };
  }

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

function sumKnown(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return round(total);
}

/**
 * The cost of every attempt one generation paid for, labelled by the last.
 *
 * Unknown stays unknown: if any attempt had no price, a total would be a
 * partial sum reading as a whole one.
 */
export function sumCosts(estimates: readonly [CostEstimate, ...CostEstimate[]]): CostEstimate {
  const last = estimates.at(-1) ?? estimates[0];
  if (estimates.length === 1) return last;
  const unpriced = estimates.find((estimate) => !estimate.pricing.known);
  return {
    provider: last.provider,
    model: last.model,
    inputCostUsd: sumKnown(estimates.map((estimate) => estimate.inputCostUsd)),
    outputCostUsd: sumKnown(estimates.map((estimate) => estimate.outputCostUsd)),
    totalCostUsd: sumKnown(estimates.map((estimate) => estimate.totalCostUsd)),
    pricing: unpriced?.pricing ?? last.pricing,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
