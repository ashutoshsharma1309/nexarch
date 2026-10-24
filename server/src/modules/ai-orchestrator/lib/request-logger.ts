/** Structured logging for every AI call, on top of the platform's shared Winston logger — this module's own fields (provider, model, tokens, cache hit), not a reimplementation of logging. */
import { logger } from '../../../shared/logger/index.js';
import { logEvent } from '../../../shared/logger/events.js';
import type { GenerationRecord } from '../ai-orchestrator.types.js';

export function logGenerationStart(promptId: string, provider: string, model: string): void {
  logger.info('ai generation started', { promptId, provider, model });
}

export function logGenerationResult(record: GenerationRecord): void {
  logEvent({
    event: 'model.call',
    provider: record.provider,
    model: record.model,
    outcome: record.status,
    operation: record.promptId,
    callId: record.id,
    durationMs: record.durationMs,
    /*
     * Counts ship only where the record really holds them. A cache hit made
     * no provider call. A failed record is built with `retries: 0` by the
     * orchestrator's catch path whatever the retry chain actually did, so
     * publishing that zero would report a measurement nobody took; on the
     * success and cached paths `retries` is the length of the failed-attempt
     * list, which makes the call count exact.
     */
    ...(record.status === 'failed'
      ? {}
      : { calls: record.cacheHit ? 0 : record.retries + 1, retries: record.retries }),
    /*
     * Tokens and cost describe what this call spent. A cache hit spent
     * nothing: its usage is the original call's, replayed, and its cost is a
     * price nobody paid — summing either across log lines would invent spend
     * the platform never incurred. A failed call's zeroed usage is a
     * placeholder, not a reading; its zero cost is measured, and ships.
     */
    ...(record.status === 'success' ? { tokens: record.tokens } : {}),
    ...(record.status === 'cached' ? {} : { costUsd: record.cost.totalCostUsd }),
    ...(record.error === undefined ? {} : { reason: record.error }),
  });
}
