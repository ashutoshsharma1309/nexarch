/** Turns what `generate()` reports into the usage figures a research artifact carries. */
import type { GenerationRecord } from '../../ai-orchestrator/ai-orchestrator.types.js';
import type { ResearchModelCall } from '../web-research.types.js';

/**
 * Taken off a caller's limit before handing it to `generate()`, so the model
 * call gives up, and is cancelled, before the race below abandons it. An
 * abandoned call still finishes and is still billed.
 */
export const BUDGET_MARGIN_MS = 1_000;

/**
 * A slow model must not hold up a build. This is the backstop behind the time
 * budget given to `generate()`; `Promise.race` still observes a late rejection.
 */
export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function modelCallFromRecord(
  purpose: ResearchModelCall['purpose'],
  record: GenerationRecord,
): ResearchModelCall {
  // A cached answer reports zero because nothing was spent, not because usage went missing.
  const tokensReported =
    record.cacheHit || record.tokens.inputTokens > 0 || record.tokens.outputTokens > 0;
  const notes: string[] = [];
  if (record.cacheHit) notes.push('served from the response cache, so nothing was billed');
  if (!tokensReported) notes.push('the provider did not report token counts');
  if (record.retries > 0) {
    notes.push(
      `answered after ${String(record.retries)} failed attempt(s) or provider failover(s)`,
    );
  }
  if (!record.cacheHit && !record.cost.pricing.known) {
    notes.push(`cost unavailable: ${record.cost.pricing.reason}`);
  }
  return {
    purpose,
    status: record.status === 'failed' ? 'failed' : 'success',
    provider: record.provider,
    model: record.model,
    inputTokens: tokensReported ? record.tokens.inputTokens : null,
    outputTokens: tokensReported ? record.tokens.outputTokens : null,
    costUsd: record.cacheHit ? 0 : record.cost.totalCostUsd,
    cacheHit: record.cacheHit,
    durationMs: record.durationMs,
    note: notes.length > 0 ? notes.join('; ') : null,
  };
}

/** A call that threw leaves no record, so its figures are unknown rather than zero. */
export function modelCallFailure(
  purpose: ResearchModelCall['purpose'],
  startedAt: number,
): ResearchModelCall {
  return {
    purpose,
    status: 'failed',
    provider: 'unknown',
    model: 'unknown',
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    note: 'the call failed or timed out, so provider, model, tokens and cost are unavailable',
  };
}
