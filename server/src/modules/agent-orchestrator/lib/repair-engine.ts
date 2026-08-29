/**
 * The autonomous engineering loop, with every brake the spec demands.
 *
 * The strict principle governs the shape of this file: DETECT is upstream
 * (the finding store), UNDERSTAND is `analyzeRootCause`, PLAN is
 * `planRepair`, PATCH is the strategy behind `produceEdits`, VALIDATE is
 * the targeted checks, and ACCEPT/ROLLBACK is decided *here*, from check
 * outcomes only. There is no path where a model's confidence substitutes
 * for a passing check.
 *
 * The brakes, each with its stop state:
 *
 *   attempts per finding      → REJECTED after the configured maximum
 *   repairs per session       → REPAIR_BUDGET_EXCEEDED
 *   wall-clock and tokens     → REPAIR_BUDGET_EXCEEDED
 *   fixed-then-back findings  → REPAIR_LOOP, never re-repaired
 *   regression on a baseline  → mandatory rollback, REGRESSION
 *
 * Validation escalates rather than repeats (Step 14): attempt one runs the
 * plan's targeted checks; a retry runs the full check set, because a
 * second failure means the targeted view was too narrow.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../../shared/logger/index.js';
import { classifyFinding, orderForRepair } from './repair-eligibility.js';
import { analyzeRootCause, planRepair } from './repair-analysis.js';
import { produceEdits } from './repair-strategies.js';
import { applyEdits, rollbackChangeset, snapshotFiles } from './repair-files.js';
import { realValidator } from './repair-validator.js';
import { activeSession, saveRepair, saveSession, wasFixedBefore } from './repair-store.js';
import { latestArtifacts } from './artifact-store.js';
import { listFindings, setFindingRepairState } from './finding-store.js';
import { syncProjectArtifacts } from './graph-sync.js';
import type { FindingRecord } from './finding-store.js';
import type { RepairValidator } from './repair-validator.js';
import type { StrategyResult } from './repair-strategies.js';
import type { ArtifactType } from '../../../shared/contracts/index.js';
import type {
  FinalQualityState,
  RepairAttempt,
  RepairCheckKind,
  RepairCheckOutcome,
  RepairConfig,
  RepairPlan,
  RepairRecord,
  RepairSessionState,
  RootCauseAnalysis,
} from '../../../shared/types/repair.js';
import { DEFAULT_REPAIR_CONFIG } from '../../../shared/types/repair.js';

export interface RepairDeps {
  validator: RepairValidator;
  produce: (
    finding: FindingRecord,
    rca: RootCauseAnalysis,
    plan: RepairPlan,
  ) => Promise<StrategyResult>;
}

const DEFAULT_DEPS: RepairDeps = {
  validator: realValidator,
  produce: (finding, rca, plan) => produceEdits(finding, rca, plan, ''),
};

const ALL_CHECKS: RepairCheckKind[] = ['TYPECHECK', 'CONTRACT_AUDIT', 'MANIFEST_AUDIT'];

export class RepairSessionConflictError extends Error {}

export async function runRepairSession(
  projectId: string,
  overrides: Partial<RepairConfig> = {},
  deps: RepairDeps = DEFAULT_DEPS,
): Promise<RepairSessionState> {
  if (activeSession(projectId)) {
    throw new RepairSessionConflictError('A repair session is already running for this project.');
  }

  const config: RepairConfig = { ...DEFAULT_REPAIR_CONFIG, ...overrides };
  const startedAt = Date.now();

  const session: RepairSessionState = {
    id: randomUUID(),
    projectId,
    status: 'RUNNING',
    finalState: 'REPAIRING',
    stopReason: '',
    counts: {
      considered: 0,
      autoRepairable: 0,
      fixed: 0,
      rejected: 0,
      requiresReview: 0,
      notRepairable: 0,
      rolledBack: 0,
      repairLoops: 0,
    },
    tokens: { input: 0, output: 0, context: 0 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    activeFindingId: null,
  };
  saveSession(session);

  try {
    await repairLoop(session, config, deps, startedAt);
    session.status = 'COMPLETED';
  } catch (error) {
    session.status = 'FAILED';
    session.finalState = 'FAILED';
    session.stopReason = `The repair engine itself failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('repair session crashed', { projectId, error });
  }

  session.completedAt = new Date().toISOString();
  session.activeFindingId = null;
  saveSession(session);

  // The graph reflects the repaired project, with live finding statuses.
  await syncGraph(projectId, session.id);
  return session;
}

async function repairLoop(
  session: RepairSessionState,
  config: RepairConfig,
  deps: RepairDeps,
  startedAt: number,
): Promise<void> {
  const { projectId } = session;

  /* ── Classify everything up front (Step 2) ────────────────────────── */

  const open = listFindings(projectId).filter((finding) => finding.status === 'OPEN');
  session.counts.considered = open.length;

  const queue: FindingRecord[] = [];
  for (const finding of open) {
    const decision = classifyFinding(finding);
    if (decision.eligibility === 'AUTO_REPAIRABLE') {
      if (wasFixedBefore(projectId, finding.id)) {
        // Fixed before, back again: the doomed surgery stops here.
        session.counts.repairLoops += 1;
        setFindingRepairState(projectId, finding.id, 'REPAIR_LOOP');
        saveRepair(skeletonRecord(session, finding, decision.reason, 'REPAIR_LOOP'));
        continue;
      }
      session.counts.autoRepairable += 1;
      queue.push(finding);
    } else if (decision.eligibility === 'REQUIRES_REVIEW') {
      session.counts.requiresReview += 1;
      setFindingRepairState(projectId, finding.id, 'REQUIRES_REVIEW');
      saveRepair(skeletonRecord(session, finding, decision.reason, 'REQUIRES_REVIEW'));
    } else {
      session.counts.notRepairable += 1;
      setFindingRepairState(projectId, finding.id, 'NOT_REPAIRABLE');
      saveRepair(skeletonRecord(session, finding, decision.reason, 'NOT_REPAIRABLE'));
    }
  }

  /* ── Baseline: what passes before anything is touched (Step 17) ───── */

  const baseline = new Map<RepairCheckKind, RepairCheckOutcome>();
  for (const kind of ALL_CHECKS) {
    baseline.set(kind, await deps.validator.run(projectId, kind));
  }
  const baselinePassing = ALL_CHECKS.filter((kind) => baseline.get(kind)?.status === 'PASS');

  /* ── The loop (Steps 3, 15, 36) ───────────────────────────────────── */

  let repairsAttempted = 0;
  for (const finding of orderForRepair(queue)) {
    if (repairsAttempted >= config.maxRepairsPerRun) {
      finish(
        session,
        'REPAIR_BUDGET_EXCEEDED',
        `The per-run repair limit (${String(config.maxRepairsPerRun)}) was reached.`,
      );
      return;
    }
    if (Date.now() - startedAt > config.maxDurationMs) {
      finish(session, 'REPAIR_BUDGET_EXCEEDED', 'The repair time budget was exhausted.');
      return;
    }
    if (session.tokens.input + session.tokens.output > config.maxTokens) {
      finish(session, 'REPAIR_BUDGET_EXCEEDED', 'The repair token budget was exhausted.');
      return;
    }

    repairsAttempted += 1;
    session.activeFindingId = finding.id;
    saveSession(session);
    await repairOne(session, finding, config, deps, baselinePassing);
  }

  /* ── Final state (Step 38) ────────────────────────────────────────── */

  const remaining = listFindings(projectId);
  const stillBroken = remaining.filter(
    (finding) =>
      ['OPEN', 'REJECTED', 'REGRESSION', 'REPAIR_LOOP'].includes(finding.status) &&
      ['CRITICAL', 'HIGH'].includes(finding.severity),
  );

  if (session.counts.repairLoops > 0 && session.counts.fixed === 0 && queue.length === 0) {
    finish(
      session,
      'REPAIR_LOOP_DETECTED',
      'Every repairable finding has looped before; nothing safe remains to try.',
    );
  } else if (stillBroken.length > 0) {
    finish(
      session,
      'FAILED',
      `${String(stillBroken.length)} critical or high finding(s) remain unresolved.`,
    );
  } else if (session.counts.requiresReview > 0) {
    finish(
      session,
      'REQUIRES_REVIEW',
      `${String(session.counts.requiresReview)} finding(s) need a person's decision.`,
    );
  } else if (remaining.some((finding) => finding.status === 'OPEN')) {
    finish(session, 'PASSED_WITH_WARNINGS', 'Only low-severity findings remain open.');
  } else {
    finish(session, 'PASSED', 'No repairable findings remain and nothing awaits review.');
  }
}

async function repairOne(
  session: RepairSessionState,
  finding: FindingRecord,
  config: RepairConfig,
  deps: RepairDeps,
  baselinePassing: readonly RepairCheckKind[],
): Promise<void> {
  const { projectId } = session;
  const repairStarted = Date.now();
  const record = skeletonRecord(session, finding, 'auto-repairable by rule', 'SKIPPED');
  setFindingRepairState(projectId, finding.id, 'IN_REPAIR');

  /* UNDERSTAND (Steps 4–5). */
  const rca = analyzeRootCause(finding);
  record.rootCause = rca;
  if (rca.confidence < config.minConfidence || rca.repairability !== 'AUTO_REPAIRABLE') {
    record.result = 'REQUIRES_REVIEW';
    record.durationMs = Date.now() - repairStarted;
    setFindingRepairState(projectId, finding.id, 'REQUIRES_REVIEW');
    session.counts.requiresReview += 1;
    session.counts.autoRepairable -= 1;
    saveRepair(record);
    return;
  }

  /* PLAN (Step 6). */
  const plan = planRepair(finding, rca);
  record.plan = plan;
  if (!plan) {
    record.result = 'REQUIRES_REVIEW';
    record.durationMs = Date.now() - repairStarted;
    setFindingRepairState(projectId, finding.id, 'REQUIRES_REVIEW');
    session.counts.requiresReview += 1;
    session.counts.autoRepairable -= 1;
    saveRepair(record);
    return;
  }

  /* PATCH → VALIDATE → ACCEPT or ROLLBACK, bounded attempts (Step 15). */
  for (let attempt = 1; attempt <= config.maxAttemptsPerFinding; attempt += 1) {
    const attemptStarted = Date.now();
    const produced = await deps.produce(finding, rca, plan);
    if (produced.usage) {
      session.tokens.input += produced.usage.inputTokens;
      session.tokens.output += produced.usage.outputTokens;
      session.tokens.context += produced.usage.contextTokens;
      record.tokens.input += produced.usage.inputTokens;
      record.tokens.output += produced.usage.outputTokens;
      record.tokens.context += produced.usage.contextTokens;
    }

    if (produced.edits.length === 0) {
      record.attempts.push({
        attempt,
        strategy: produced.strategy,
        applied: false,
        checks: [],
        regressions: [],
        outcome: 'PATCH_FAILED',
        error: produced.error ?? 'The strategy produced no edits.',
        durationMs: Date.now() - attemptStarted,
      });
      continue;
    }

    /* Snapshot before the patch (Step 12), then apply through the gate. */
    const snapshot = snapshotFiles(projectId, plan.authorizedFiles);
    let changeset;
    try {
      changeset = applyEdits(
        projectId,
        session.id,
        record.id,
        finding.id,
        plan.intent,
        produced.edits,
        plan.authorizedFiles,
      );
    } catch (error) {
      record.attempts.push({
        attempt,
        strategy: produced.strategy,
        applied: false,
        checks: [],
        regressions: [],
        outcome: 'PATCH_FAILED',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - attemptStarted,
      });
      continue;
    }
    record.changeset = changeset;

    /* Targeted validation; a retry escalates to the full set (Step 14). */
    const kinds = attempt === 1 ? plan.validation : ALL_CHECKS;
    const checks: RepairCheckOutcome[] = [];
    for (const kind of kinds) {
      // Targeted means targeted: the plan's own checks run scoped to its
      // authorized files. The regression guard below stays unscoped.
      checks.push(await deps.validator.run(projectId, kind, plan.authorizedFiles));
    }
    const targetedFailed = checks.some((check) => check.status === 'FAIL');

    /* Regression guard (Step 17): baseline-passing checks must still pass. */
    const regressions: string[] = [];
    if (!targetedFailed) {
      for (const kind of baselinePassing) {
        if (kinds.includes(kind)) continue;
        const outcome = await deps.validator.run(projectId, kind);
        checks.push(outcome);
        if (outcome.status === 'FAIL') regressions.push(`${kind}: ${outcome.evidence}`);
      }
    }

    const attemptRecord: RepairAttempt = {
      attempt,
      strategy: produced.strategy,
      applied: true,
      checks,
      regressions,
      outcome:
        regressions.length > 0 ? 'REGRESSION' : targetedFailed ? 'VALIDATION_FAILED' : 'ACCEPTED',
      error: targetedFailed
        ? (checks.find((check) => check.status === 'FAIL')?.evidence ?? 'validation failed')
        : null,
      durationMs: Date.now() - attemptStarted,
    };
    record.attempts.push(attemptRecord);

    if (attemptRecord.outcome === 'ACCEPTED') {
      record.result = 'FIXED';
      record.durationMs = Date.now() - repairStarted;
      setFindingRepairState(projectId, finding.id, 'FIXED');
      session.counts.fixed += 1;
      saveRepair(record);
      saveSession(session);
      return;
    }

    /* FAIL → mandatory rollback before anything else (Steps 17, 19). */
    rollbackChangeset(projectId, session.id, changeset, snapshot);
    session.counts.rolledBack += 1;
    record.rolledBack = true;

    if (attemptRecord.outcome === 'REGRESSION') {
      // A patch that breaks working functionality does not get retried;
      // the next attempt would be the same surgery on the same patient.
      record.result = 'REGRESSION';
      record.durationMs = Date.now() - repairStarted;
      setFindingRepairState(projectId, finding.id, 'REGRESSION');
      saveRepair(record);
      saveSession(session);
      return;
    }
  }

  record.result = 'REJECTED';
  record.durationMs = Date.now() - repairStarted;
  setFindingRepairState(projectId, finding.id, 'REJECTED');
  session.counts.rejected += 1;
  saveRepair(record);
  saveSession(session);
}

function finish(session: RepairSessionState, state: FinalQualityState, reason: string): void {
  session.finalState = state;
  session.stopReason = reason;
  saveSession(session);
  logger.info('repair session settled', {
    projectId: session.projectId,
    finalState: state,
    reason,
    ...session.counts,
  });
}

function skeletonRecord(
  session: RepairSessionState,
  finding: FindingRecord,
  reason: string,
  result: RepairRecord['result'],
): RepairRecord {
  return {
    id: randomUUID(),
    projectId: session.projectId,
    findingId: finding.id,
    findingTitle: finding.title,
    severity: finding.severity,
    agentId: 'repair-engineer',
    eligibility: {
      eligibility:
        result === 'SKIPPED'
          ? 'AUTO_REPAIRABLE'
          : result === 'NOT_REPAIRABLE'
            ? 'NOT_REPAIRABLE'
            : result === 'REPAIR_LOOP'
              ? 'AUTO_REPAIRABLE'
              : 'REQUIRES_REVIEW',
      reason,
    },
    rootCause: null,
    plan: null,
    attempts: [],
    changeset: null,
    result,
    rolledBack: false,
    tokens: { input: 0, output: 0, context: 0 },
    durationMs: 0,
    createdAt: new Date().toISOString(),
  };
}

/** The graph reflects the latest artifacts and the live finding statuses. */
async function syncGraph(projectId: string, sessionId: string): Promise<void> {
  const artifacts: Partial<Record<ArtifactType, unknown>> = {};
  for (const record of latestArtifacts(projectId)) artifacts[record.type] = record.content;

  const review = artifacts['engineering-review'] as { findings?: unknown[] } | undefined;
  if (review) {
    // The stored review is a snapshot; the graph should carry the statuses
    // the repairs just earned.
    artifacts['engineering-review'] = { ...review, findings: listFindings(projectId) };
  }

  await syncProjectArtifacts(projectId, sessionId, artifacts);
}
