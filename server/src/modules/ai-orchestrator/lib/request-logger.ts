/** Structured logging for every AI call, on top of the platform's shared Winston logger — this module's own fields (provider, model, tokens, cache hit), not a reimplementation of logging. */
import { logger } from '../../../shared/logger/index.js';
import type { GenerationRecord } from '../ai-orchestrator.types.js';

export function logGenerationStart(promptId: string, provider: string, model: string): void {
  logger.info('ai generation started', { promptId, provider, model });
}

export function logGenerationResult(record: GenerationRecord): void {
  const context = {
    id: record.id,
    promptId: record.promptId,
    provider: record.provider,
    model: record.model,
    status: record.status,
    cacheHit: record.cacheHit,
    retries: record.retries,
    durationMs: record.durationMs,
    tokens: record.tokens,
    costUsd: record.cost.totalCostUsd,
  };
  if (record.status === 'failed')
    logger.warn('ai generation failed', { ...context, error: record.error });
  else logger.info('ai generation completed', context);
}
