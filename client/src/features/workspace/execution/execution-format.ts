/** Display helpers. Every figure shown comes from the server; none is estimated here. */
import type { ExecutionJobKind } from '@/shared/types/execution';
import type { UsageTotals } from './execution-model';

const STAGE_LABELS: Record<string, string> = {
  analysis: 'Requirement Analysis',
  research: 'Web Research',
  decision: 'Product Decisions',
  'design-intelligence': 'Design Intelligence',
  architecture: 'Architecture Planning',
  database: 'Database Design',
  backend: 'Backend Generation',
  frontend: 'Frontend Generation',
  security: 'Security Hardening',
  dependencies: 'Dependency Graph',
  verification: 'Build Verification',
  repair: 'Repair',
  graph: 'Engineering Graph',
  queued: 'Queued',
  researching: 'Researching',
  planning: 'Planning',
  implementing: 'Implementing',
  testing: 'Testing',
  repairing: 'Repairing',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

export function stageLabel(id: string): string {
  return STAGE_LABELS[id] ?? id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Verification and repair publish the enhancement names on every job, and the
 * enhancement worker uses `research` for its research events. Collapsing the
 * aliases keeps one stage on one row.
 */
export function canonicalStage(kind: ExecutionJobKind, stage: string): string {
  if (kind === 'RUN') {
    if (stage === 'testing') return 'verification';
    if (stage === 'repairing') return 'repair';
    return stage;
  }
  return stage === 'research' ? 'researching' : stage;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'Not available';
  if (ms < 1_000) return `${String(Math.round(ms))} ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} min ${String(Math.round(seconds - minutes * 60))} s`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return 'Not available';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleTimeString();
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Not available';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

export function formatCost(usd: number): string {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** A cost figure that does not read as free when some calls had no price. */
export function formatKnownCost(usd: number, calls: number, unpricedCalls?: number): string {
  // A record from before the count existed: $0 across real calls is not a measurement.
  const unpriced = unpricedCalls ?? (usd === 0 && calls > 0 ? calls : 0);
  if (unpriced >= calls && calls > 0) return 'cost unknown';
  const shown = `$${usd.toFixed(4)}`;
  return unpriced > 0
    ? `at least ${shown} (${String(unpriced)} of ${String(calls)} calls not priced)`
    : shown;
}

/** Token totals with the same honesty: zero from real calls is an absence. */
export function formatKnownTokens(total: number, calls: number, unreportedCalls = 0): string {
  if (total === 0 && calls > 0) return 'tokens not reported';
  return unreportedCalls > 0 ? `at least ${String(total)} tokens` : `${String(total)} tokens`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

/** A partial total is labelled as one, so an unreported call cannot read as free. */
export function usageLines(usage: UsageTotals | null): { tokens: string; cost: string } {
  if (!usage) return { tokens: 'Not available', cost: 'Not available' };
  const known = usage.inputTokens !== null || usage.outputTokens !== null;
  const tokens = known
    ? `${formatCount(usage.inputTokens ?? 0)} in, ${formatCount(usage.outputTokens ?? 0)} out`
    : 'Not available';
  const cost = usage.costUsd === null ? 'Not available' : formatCost(usage.costUsd);
  return {
    tokens:
      known && usage.unreportedTokens > 0
        ? `At least ${tokens} (${String(usage.unreportedTokens)} of ${String(usage.calls)} calls not reported)`
        : tokens,
    cost:
      usage.costUsd !== null && usage.unreportedCost > 0
        ? `At least ${cost} (${String(usage.unreportedCost)} of ${String(usage.calls)} calls not priced)`
        : cost,
  };
}
