/**
 * In-memory generation history — every `generate()` call, in order,
 * feeding both `GET /ai/history` and the cost analytics `GET
 * /ai/statistics` reads. Same "most recent in this process" model as the
 * rest of the platform's internal state (no persistence layer exists for
 * it — the platform's own `generations` table reserved in the schema
 * tracks coarse per-project runs, not per-AI-call token/cost/cache detail,
 * so it isn't a fit here without extending that schema, which Phase 9
 * doesn't own).
 */
import type { CacheStats, CostAnalytics, GenerationRecord } from '../ai-orchestrator.types.js';

const history: GenerationRecord[] = [];
let version = 0;

export function nextVersion(): number {
  version += 1;
  return version;
}

export function recordGeneration(record: GenerationRecord): void {
  history.push(record);
}

export function listHistory(limit?: number): GenerationRecord[] {
  const ordered = [...history].reverse();
  return limit ? ordered.slice(0, limit) : ordered;
}

export function getGeneration(id: string): GenerationRecord | null {
  return history.find((r) => r.id === id) ?? null;
}

export function computeCostAnalytics(cache: CacheStats): CostAnalytics {
  const totalGenerations = history.length;
  const totalTokens = history.reduce(
    (sum, r) => sum + r.tokens.inputTokens + r.tokens.outputTokens,
    0,
  );
  const totalCostUsd = round(history.reduce((sum, r) => sum + r.cost.totalCostUsd, 0));
  const totalDuration = history.reduce((sum, r) => sum + r.durationMs, 0);

  const byProvider: CostAnalytics['byProvider'] = {};
  const byComplexity: CostAnalytics['byComplexity'] = {};

  for (const record of history) {
    const providerBucket = byProvider[record.provider] ?? { generations: 0, tokens: 0, costUsd: 0 };
    providerBucket.generations += 1;
    providerBucket.tokens += record.tokens.inputTokens + record.tokens.outputTokens;
    providerBucket.costUsd = round(providerBucket.costUsd + record.cost.totalCostUsd);
    byProvider[record.provider] = providerBucket;

    byComplexity[record.complexity] = (byComplexity[record.complexity] ?? 0) + 1;
  }

  return {
    totalGenerations,
    totalTokens,
    averageTokens: totalGenerations > 0 ? Math.round(totalTokens / totalGenerations) : 0,
    totalCostUsd,
    averageCostUsd: totalGenerations > 0 ? round(totalCostUsd / totalGenerations) : 0,
    averageDurationMs: totalGenerations > 0 ? Math.round(totalDuration / totalGenerations) : 0,
    cache,
    byProvider,
    byComplexity,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Test-only reset so each test file starts from a clean slate. */
export function resetHistoryForTests(): void {
  history.length = 0;
  version = 0;
}
