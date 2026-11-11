/**
 * What the models really cost.
 *
 * Every figure comes from the call's own record. A provider that reported no
 * tokens is recorded as unknown, because a zero would read as a free call.
 */
import type { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import type {
  GenerateRequest,
  GenerateResponse,
} from '../../ai-orchestrator/ai-orchestrator.types.js';
import type { EnhancementResult, ModelCallUsage } from '../enhancement.types.js';

export type UsageSink = (usage: ModelCallUsage) => void;

export function usageFromResponse(
  response: GenerateResponse,
  stage: string,
  agentId: string,
): ModelCallUsage {
  const { record } = response;
  const reported =
    record.cacheHit || record.tokens.inputTokens > 0 || record.tokens.outputTokens > 0;
  return {
    stage,
    agentId,
    provider: record.provider,
    model: record.model,
    inputTokens: reported ? record.tokens.inputTokens : null,
    outputTokens: reported ? record.tokens.outputTokens : null,
    costUsd: record.cost.totalCostUsd,
    durationMs: record.durationMs,
    cacheHit: record.cacheHit,
  };
}

export type ModelCaller = (
  request: GenerateRequest,
  meta: { stage: string; agentId: string; maxOutputTokens: number },
) => Promise<GenerateResponse>;

/**
 * Wraps `generate` so no model call can go unrecorded.
 *
 * Always asks past the response cache. A prompt here holds the files it is
 * changing, so the cache could only answer a request already made against
 * these exact files and not applied since: a cancelled, failed or rejected
 * attempt. Replaying that answer is what made a retry fail again in seconds.
 */
export function modelCaller(run: typeof generate, sink: UsageSink): ModelCaller {
  return async (request, meta) => {
    const response = await run(request, {
      maxOutputTokens: meta.maxOutputTokens,
      forceRefresh: true,
    });
    sink(usageFromResponse(response, meta.stage, meta.agentId));
    return response;
  };
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

export function usageTotals(calls: readonly ModelCallUsage[]): EnhancementResult['usage'] {
  return {
    calls: calls.length,
    inputTokens: sumKnown(calls.map((call) => call.inputTokens)),
    outputTokens: sumKnown(calls.map((call) => call.outputTokens)),
    costUsd: sumKnown(calls.map((call) => call.costUsd)),
  };
}

/** The shape a pipeline run stores. Known figures only, summed. */
export function runAiSummary(calls: readonly ModelCallUsage[]): {
  calls: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  unpricedCalls?: number;
  unreportedTokenCalls?: number;
} {
  const totals = usageTotals(calls);
  const unpricedCalls = calls.filter((call) => call.costUsd === null).length;
  const unreportedTokenCalls = calls.filter(
    (call) => call.inputTokens === null && call.outputTokens === null,
  ).length;
  const providers = new Set(calls.map((call) => call.provider));
  const models = new Set(calls.map((call) => call.model));
  const single = (values: Set<string>): string =>
    values.size === 0 ? 'none' : values.size === 1 ? ([...values][0] ?? 'none') : 'mixed';
  return {
    calls: calls.length,
    provider: single(providers),
    model: single(models),
    inputTokens: totals.inputTokens ?? 0,
    outputTokens: totals.outputTokens ?? 0,
    estimatedCostUsd: totals.costUsd ?? 0,
    ...(unpricedCalls > 0 ? { unpricedCalls } : {}),
    ...(unreportedTokenCalls > 0 ? { unreportedTokenCalls } : {}),
  };
}
