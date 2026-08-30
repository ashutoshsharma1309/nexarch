/**
 * One project, summed up — the data behind the intelligence dashboard.
 *
 * Everything here is assembled from stores that already exist: the finding
 * store, the artifact store's versioned summaries, the repair store, the
 * run store, and the Engineering Graph. Nothing is recomputed and nothing
 * is invented; where a subsystem has never run, the answer is NOT_RUN and
 * the dashboard says so, because a dashboard that fills silence with
 * plausible numbers trains its users to distrust the real ones.
 *
 * Health is a rule table, not a score. Each category's state comes with
 * the sentence that produced it, so "SECURITY: WARNING" is always
 * accompanied by "2 medium findings open" — the explanation is part of
 * the calculation, not an afterthought.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { artifactHistory, latestArtifact } from './artifact-store.js';
import { listFindings } from './finding-store.js';
import { latestSession as latestRepairSession } from './repair-store.js';
import { listRuns } from './run-store.js';
import type { FindingRecord } from './finding-store.js';
import type { AgentRun } from '../agent-orchestrator.types.js';
import type { RepairSessionState } from '../../../shared/types/repair.js';
import type { ValidationSummary } from '../../../shared/types/validation.js';
import type { ReviewSummary } from './review-summary.js';

export type HealthState = 'HEALTHY' | 'WARNING' | 'FAILED' | 'NOT_RUN' | 'BLOCKED';

export interface HealthEntry {
  category: string;
  state: HealthState;
  /** The sentence that produced the state. Always present. */
  detail: string;
}

export type ProjectStatus =
  | 'NOT_RUN'
  | 'BUILDING'
  | 'REVIEWING'
  | 'VALIDATING'
  | 'REPAIRING'
  | 'HEALTHY'
  | 'HEALTHY_WITH_WARNINGS'
  | 'REQUIRES_REVIEW'
  | 'FAILED';

export interface RunHistoryEntry {
  runId: string;
  createdAt: string;
  /** Live run state when the run is still in memory; SETTLED otherwise. */
  status: string;
  durationMs: number | null;
  agentsCompleted: number | null;
  agentsTotal: number | null;
  /** From that run's engineering review, when one was recorded. */
  findings: number | null;
  reviewScore: number | null;
  /** From that run's validation summary, when one was recorded. */
  gate: string | null;
  testsPassed: number | null;
  testsTotal: number | null;
  tokens: { input: number; output: number; costUsd: number } | null;
}

export interface ProjectIntelligence {
  status: ProjectStatus;
  statusReason: string;
  health: HealthEntry[];
  metrics: {
    graphNodes: number | null;
    graphEdges: number | null;
    services: number;
    apis: number;
    entities: number;
    files: number;
    agentsExecuted: number;
    findings: number;
    testsTotal: number;
    testsPassed: number;
    repairsFixed: number;
  };
  graphPreview: {
    services: string[];
    entities: string[];
    apis: number;
    dependencies: string[];
  } | null;
  agents:
    | {
        agentId: string;
        name: string;
        status: string;
        durationMs: number | null;
        summary: string | null;
      }[]
    | null;
  timeline: { at: string; label: string; detail: string | null }[];
  findings: {
    total: number;
    open: number;
    fixed: number;
    requiresReview: number;
    bySeverity: Record<string, number>;
  } | null;
  validation: Pick<ValidationSummary, 'gate' | 'gateReason' | 'rows' | 'tests'> | null;
  repairs: Pick<RepairSessionState, 'finalState' | 'stopReason' | 'counts'> | null;
  tokens: {
    aiCalls: number;
    inputTokens: number;
    outputTokens: number;
    contextTokens: number;
    costUsd: number;
    byAgent: { agentId: string; name: string; tokens: number; costUsd: number }[];
    /** Agent-result cache accounting for the latest run (Steps 28, 31). */
    efficiency: {
      cacheHits: number;
      cacheMisses: number;
      tokensSaved: number;
      aiCallsSaved: number;
      cachedAgents: number;
    } | null;
  } | null;
  runs: RunHistoryEntry[];
}

/* ── Health rules (Steps 4–5) ─────────────────────────────────────────── */

function rowState(row: { status: string } | undefined): HealthState {
  if (!row) return 'NOT_RUN';
  if (row.status === 'PASS') return 'HEALTHY';
  if (row.status === 'FAIL') return 'FAILED';
  if (row.status === 'BLOCKED') return 'BLOCKED';
  return 'NOT_RUN';
}

/** Open findings of one type, graded: CRITICAL fails, HIGH/MEDIUM warn. */
function findingHealth(category: string, findings: FindingRecord[], type: string): HealthEntry {
  const open = findings.filter(
    (finding) =>
      finding.type === type &&
      ['OPEN', 'REQUIRES_REVIEW', 'REJECTED', 'REGRESSION'].includes(finding.status),
  );
  const reviewed = findings.some((finding) => finding.type === type);
  if (!reviewed) return { category, state: 'NOT_RUN', detail: 'No review has run.' };

  const critical = open.filter((finding) => finding.severity === 'CRITICAL').length;
  const meaningful = open.filter((finding) => ['HIGH', 'MEDIUM'].includes(finding.severity)).length;
  const minor = open.filter((finding) => ['LOW'].includes(finding.severity)).length;

  if (critical > 0) {
    return {
      category,
      state: 'FAILED',
      detail: `${String(critical)} critical finding(s) unresolved.`,
    };
  }
  if (meaningful > 0) {
    return {
      category,
      state: 'WARNING',
      detail: `${String(meaningful)} high/medium finding(s) unresolved.`,
    };
  }
  if (minor > 0) {
    return {
      category,
      state: 'HEALTHY',
      detail: `Only ${String(minor)} low finding(s) unresolved.`,
    };
  }
  return { category, state: 'HEALTHY', detail: 'No findings unresolved.' };
}

export function computeHealth(
  validation: ValidationSummary | null,
  findings: FindingRecord[],
  repairs: RepairSessionState | null,
): HealthEntry[] {
  const row = (name: string): { status: string } | undefined =>
    validation?.rows.find((entry) => entry.name === name);

  const entries: HealthEntry[] = [];

  const build = rowState(row('Build'));
  const typecheck = rowState(row('Type Check'));
  const buildState: HealthState =
    build === 'FAILED' || typecheck === 'FAILED'
      ? 'FAILED'
      : build === 'NOT_RUN'
        ? 'NOT_RUN'
        : rowState(row('Lint')) === 'FAILED'
          ? 'WARNING'
          : build;
  entries.push({
    category: 'BUILD',
    state: buildState,
    detail: validation
      ? `build ${row('Build')?.status ?? '—'} · typecheck ${row('Type Check')?.status ?? '—'} · lint ${row('Lint')?.status ?? '—'}`
      : 'No validation has run.',
  });

  const startup = rowState(row('Startup'));
  const health = rowState(row('Health'));
  entries.push({
    category: 'RUNTIME',
    state: startup === 'HEALTHY' && health === 'FAILED' ? 'WARNING' : startup,
    detail: validation
      ? `startup ${row('Startup')?.status ?? '—'} · health ${row('Health')?.status ?? '—'}`
      : 'No validation has run.',
  });

  entries.push(findingHealth('SECURITY', findings, 'SECURITY'));
  entries.push(findingHealth('DEPENDENCIES', findings, 'DEPENDENCY'));
  entries.push(findingHealth('CODE QUALITY', findings, 'CODE_QUALITY'));

  const integrationRow = row('Integration');
  entries.push({
    category: 'INTEGRATION',
    state: rowState(integrationRow),
    detail: integrationRow
      ? (validation?.rows.find((entry) => entry.name === 'Integration')?.detail ?? '')
      : 'No validation has run.',
  });

  if (!validation || validation.tests.total === 0) {
    entries.push({ category: 'TESTS', state: 'NOT_RUN', detail: 'No tests have run.' });
  } else if (validation.tests.failedCritical > 0) {
    entries.push({
      category: 'TESTS',
      state: 'FAILED',
      detail: `${String(validation.tests.failedCritical)} critical test(s) failed.`,
    });
  } else if (validation.tests.blocked === validation.tests.total) {
    entries.push({ category: 'TESTS', state: 'BLOCKED', detail: 'Every test was blocked.' });
  } else if (validation.tests.failed > 0) {
    entries.push({
      category: 'TESTS',
      state: 'WARNING',
      detail: `${String(validation.tests.failed)} of ${String(validation.tests.total)} tests failed.`,
    });
  } else {
    entries.push({
      category: 'TESTS',
      state: 'HEALTHY',
      detail: `${String(validation.tests.passed)}/${String(validation.tests.total)} tests passed.`,
    });
  }

  if (!repairs) {
    entries.push({ category: 'REPAIRS', state: 'NOT_RUN', detail: 'No repair session has run.' });
  } else if (repairs.counts.repairLoops > 0 || repairs.counts.rolledBack > 0) {
    entries.push({
      category: 'REPAIRS',
      state: 'WARNING',
      detail: `${String(repairs.counts.fixed)} fixed · ${String(repairs.counts.rolledBack)} rolled back · ${String(repairs.counts.repairLoops)} loop(s).`,
    });
  } else {
    entries.push({
      category: 'REPAIRS',
      state: 'HEALTHY',
      detail: `${String(repairs.counts.fixed)} fixed · ${String(repairs.counts.requiresReview)} awaiting review.`,
    });
  }

  return entries;
}

/* ── Top-level status (Step 27) ───────────────────────────────────────── */

const PLANNING_AND_GENERATION = new Set([
  'requirement-analyst',
  'product-architect',
  'architecture-agent',
  'database-architect',
  'api-architect',
  'backend-engineer',
  'frontend-engineer',
  'ux-ui-engineer',
]);
const REVIEWERS = new Set(['security-engineer', 'dependency-engineer', 'code-quality-engineer']);

export function computeStatus(
  activeRun: AgentRun | null,
  repairs: RepairSessionState | null,
  health: HealthEntry[],
  findings: FindingRecord[],
): { status: ProjectStatus; reason: string } {
  if (activeRun) {
    const current = activeRun.tasks.find((task) => task.id === activeRun.currentTaskId);
    const agentId = current?.agentId ?? '';
    if (REVIEWERS.has(agentId))
      return { status: 'REVIEWING', reason: 'The review mesh is running.' };
    if (PLANNING_AND_GENERATION.has(agentId) || agentId === '') {
      return { status: 'BUILDING', reason: 'Planning and generation agents are running.' };
    }
    return { status: 'VALIDATING', reason: 'The validation mesh is running.' };
  }
  if (repairs?.status === 'RUNNING') {
    return { status: 'REPAIRING', reason: 'A repair session is in progress.' };
  }

  const ran = health.some((entry) => entry.state !== 'NOT_RUN');
  if (!ran) return { status: 'NOT_RUN', reason: 'Nothing has been built yet.' };

  const failed = health.filter((entry) => entry.state === 'FAILED');
  if (failed.length > 0) {
    return {
      status: 'FAILED',
      reason: `${failed.map((entry) => entry.category).join(', ')} failing.`,
    };
  }

  const awaiting = findings.filter((finding) => finding.status === 'REQUIRES_REVIEW').length;
  if (awaiting > 0) {
    return {
      status: 'REQUIRES_REVIEW',
      reason: `${String(awaiting)} finding(s) need a person's decision.`,
    };
  }

  const warnings = health.filter((entry) => entry.state === 'WARNING' || entry.state === 'BLOCKED');
  if (warnings.length > 0) {
    return {
      status: 'HEALTHY_WITH_WARNINGS',
      reason: `${warnings.map((entry) => entry.category).join(', ')} with warnings.`,
    };
  }
  return { status: 'HEALTHY', reason: 'Every checked category is healthy.' };
}

/* ── Run history (Steps 16–17) ────────────────────────────────────────── */

/**
 * One row per run, joined from the versioned summaries each run left
 * behind. A run still in memory contributes its live totals; a run that
 * only survives as artifacts contributes what the artifacts recorded —
 * and the fields it cannot answer stay null rather than zero.
 */
export function runHistory(projectId: string, memoryRuns: AgentRun[]): RunHistoryEntry[] {
  const reviewByRun = new Map<string, ReviewSummary>();
  for (const record of artifactHistory(projectId, 'engineering-review')) {
    const content = record.content as { runId?: string; summary?: ReviewSummary };
    if (content.runId && content.summary) reviewByRun.set(content.runId, content.summary);
  }
  const validationByRun = new Map<string, ValidationSummary>();
  for (const record of artifactHistory(projectId, 'validation-summary')) {
    const content = record.content as ValidationSummary;
    validationByRun.set(content.runId, content);
  }

  const runIds = new Set<string>([
    ...memoryRuns.map((run) => run.id),
    ...reviewByRun.keys(),
    ...validationByRun.keys(),
  ]);

  const entries: RunHistoryEntry[] = [];
  for (const runId of runIds) {
    const memory = memoryRuns.find((run) => run.id === runId) ?? null;
    const review = reviewByRun.get(runId) ?? null;
    const validation = validationByRun.get(runId) ?? null;

    const durationMs = memory
      ? new Date(memory.updatedAt).getTime() - new Date(memory.createdAt).getTime()
      : null;

    entries.push({
      runId,
      createdAt: memory?.createdAt ?? review?.generatedAt ?? validation?.generatedAt ?? '',
      status: memory?.status ?? 'SETTLED',
      durationMs,
      agentsCompleted: memory
        ? memory.tasks.filter((task) => task.status === 'COMPLETED').length
        : null,
      agentsTotal: memory ? memory.tasks.length : null,
      findings: review ? review.totals.findings : null,
      reviewScore: review ? review.score.score : null,
      gate: validation ? validation.gate : null,
      testsPassed: validation ? validation.tests.passed : null,
      testsTotal: validation ? validation.tests.total : null,
      tokens: memory
        ? {
            input: memory.totals.inputTokens,
            output: memory.totals.outputTokens,
            costUsd: memory.totals.costUsd,
          }
        : null,
    });
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
}

/* ── Assembly ─────────────────────────────────────────────────────────── */

export interface GraphStatsInput {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Partial<Record<string, number>>;
  /** Names for the preview, already limited by the caller. */
  serviceNames: string[];
  entityNames: string[];
  dependencyNames: string[];
}

export function assembleIntelligence(
  projectId: string,
  ownerId: string,
  graph: GraphStatsInput | null,
): ProjectIntelligence {
  const findings = listFindings(projectId);
  const validation =
    (latestArtifact(projectId, 'validation-summary')?.content as ValidationSummary | undefined) ??
    null;
  const repairSession = latestRepairSession(projectId);
  const memoryRuns = listRuns(ownerId).filter((run) => run.projectId === projectId);
  const latestRun =
    memoryRuns.find((run) => ['RUNNING', 'PENDING'].includes(run.status)) ?? memoryRuns[0] ?? null;
  const activeRun =
    latestRun && ['RUNNING', 'PENDING'].includes(latestRun.status) ? latestRun : null;

  const health = computeHealth(validation, findings, repairSession);
  const verdict = computeStatus(activeRun, repairSession, health, findings);
  const status = verdict.status;
  let reason = verdict.reason;
  if (status === 'NOT_RUN' && (graph?.nodeCount ?? 0) > 0) {
    // The graph persists across restarts; run, finding and repair state do
    // not. Saying "nothing has been built" over a 200-node graph would be
    // false — say what is actually known.
    reason =
      'The Engineering Graph persists from earlier runs; run, finding and validation state from previous server sessions is no longer held. Run the agents to re-validate.';
  }

  /* Agent activity: the latest run's tasks, in execution order. */
  const agents = latestRun
    ? latestRun.tasks.map((task) => ({
        agentId: task.agentId,
        name: getAgentDefinition(task.agentId)?.name ?? task.agentId,
        status: task.status,
        durationMs: task.durationMs,
        summary: task.summary ?? task.error,
      }))
    : null;

  /* Timeline: real completions with real timestamps, newest last. */
  const timeline: ProjectIntelligence['timeline'] = [];
  if (latestRun) {
    for (const task of latestRun.tasks) {
      if (!task.completedAt) continue;
      timeline.push({
        at: task.completedAt,
        label: `${getAgentDefinition(task.agentId)?.name ?? task.agentId} ${task.status === 'COMPLETED' ? 'completed' : task.status.toLowerCase()}`,
        detail: task.summary,
      });
    }
  }
  if (repairSession?.completedAt) {
    timeline.push({
      at: repairSession.completedAt,
      label: `Repair session ${repairSession.finalState.replace(/_/g, ' ').toLowerCase()}`,
      detail: repairSession.stopReason,
    });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const bySeverity: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }

  const tokensByAgent = latestRun
    ? latestRun.tasks
        .filter((task) => task.usage)
        .map((task) => ({
          agentId: task.agentId,
          name: getAgentDefinition(task.agentId)?.name ?? task.agentId,
          tokens: (task.usage?.inputTokens ?? 0) + (task.usage?.outputTokens ?? 0),
          costUsd: task.usage?.costUsd ?? 0,
        }))
        .sort((a, b) => b.tokens - a.tokens)
    : [];

  return {
    status,
    statusReason: reason,
    health,
    metrics: {
      graphNodes: graph?.nodeCount ?? null,
      graphEdges: graph?.edgeCount ?? null,
      services: graph?.nodesByType.SERVICE ?? 0,
      apis: graph?.nodesByType.API ?? 0,
      entities: graph?.nodesByType.ENTITY ?? 0,
      files: graph?.nodesByType.FILE ?? 0,
      agentsExecuted: latestRun
        ? latestRun.tasks.filter((task) => task.status === 'COMPLETED').length
        : 0,
      findings: findings.length,
      testsTotal: validation?.tests.total ?? 0,
      testsPassed: validation?.tests.passed ?? 0,
      repairsFixed: repairSession?.counts.fixed ?? 0,
    },
    graphPreview: graph
      ? {
          services: graph.serviceNames,
          entities: graph.entityNames,
          apis: graph.nodesByType.API ?? 0,
          dependencies: graph.dependencyNames,
        }
      : null,
    agents,
    timeline,
    findings:
      findings.length > 0
        ? {
            total: findings.length,
            open: findings.filter((finding) => finding.status === 'OPEN').length,
            fixed: findings.filter((finding) => finding.status === 'FIXED').length,
            requiresReview: findings.filter((finding) => finding.status === 'REQUIRES_REVIEW')
              .length,
            bySeverity,
          }
        : null,
    validation: validation
      ? {
          gate: validation.gate,
          gateReason: validation.gateReason,
          rows: validation.rows,
          tests: validation.tests,
        }
      : null,
    repairs: repairSession
      ? {
          finalState: repairSession.finalState,
          stopReason: repairSession.stopReason,
          counts: repairSession.counts,
        }
      : null,
    tokens:
      latestRun && (latestRun.totals.aiCalls > 0 || (latestRun.totals.cache?.hits ?? 0) > 0)
        ? {
            aiCalls: latestRun.totals.aiCalls,
            inputTokens: latestRun.totals.inputTokens,
            outputTokens: latestRun.totals.outputTokens,
            contextTokens: latestRun.totals.contextTokens,
            costUsd: latestRun.totals.costUsd,
            byAgent: tokensByAgent,
            efficiency: latestRun.totals.cache
              ? {
                  cacheHits: latestRun.totals.cache.hits,
                  cacheMisses: latestRun.totals.cache.misses,
                  tokensSaved: latestRun.totals.cache.tokensSaved,
                  aiCallsSaved: latestRun.totals.cache.aiCallsSaved,
                  cachedAgents: latestRun.tasks.filter((task) => task.cached).length,
                }
              : null,
          }
        : null,
    runs: runHistory(projectId, memoryRuns),
  };
}
