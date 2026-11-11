/**
 * The enhancement lifecycle: plan, apply, cancel, revert.
 *
 * Every function takes its dependencies, so the rules here (who may act, what
 * counts as stale, what a second concurrent request gets) can be tested
 * without a database. `enhancement.service.ts` binds the real ones.
 */
import { AppError } from '../../../shared/utils/app-error.js';
import { logger } from '../../../shared/logger/index.js';
import { withLogContext } from '../../../shared/logger/context.js';
import { redactString } from '../../../shared/security/redact.js';
import type { EditJob } from '../../project-editor/lib/edit-job-store.js';
import type { PipelineArtifacts, PipelineStage } from '../../pipeline/pipeline.types.js';
import type { EnhancementPlan, EnhancementResult } from '../enhancement.types.js';
import { missingAreas, requiresFunctionalCheck } from './coverage.js';
import type { EnhancementDeps } from './deps.js';
import { createPlan } from './planner.js';
import type { CreatedPlan } from './planner.js';
import { JobReporter } from './job-reporter.js';
import { fullDiff, runEnhancementJob, storable } from './worker.js';

const MAX_PLANS = 40;
const BUSY = 'Another change is already running for this project. Wait for it to finish first.';

const plans = new Map<string, CreatedPlan & { ownerId: string }>();
/** The live workers in this process, so a cancel can interrupt a long step. */
const running = new Map<string, AbortController>();

export function resetEnhancementStateForTests(): void {
  plans.clear();
  running.clear();
}

function remember(entry: CreatedPlan & { ownerId: string }): void {
  plans.set(entry.plan.planId, entry);
  while (plans.size > MAX_PLANS) {
    const oldest = plans.keys().next().value;
    if (oldest === undefined) break;
    plans.delete(oldest);
  }
}

export async function planEnhancement(
  input: {
    projectId: string;
    ownerId: string;
    instruction: string;
    research?: boolean | undefined;
    referenceUrls?: readonly string[] | undefined;
  },
  deps: EnhancementDeps,
): Promise<EnhancementPlan> {
  const created = await createPlan(input, deps);
  remember({ ...created, ownerId: input.ownerId });
  return created.plan;
}

function planOrThrow(planId: string, ownerId: string, projectId: string) {
  const entry = plans.get(planId);
  if (entry?.ownerId !== ownerId || entry.plan.projectId !== projectId) {
    throw AppError.notFound(
      'That plan is no longer available. Plans are held in memory, so a server restart clears them. Plan the change again.',
    );
  }
  return entry;
}

/** Why a plan may not run yet, or null. */
export function unappliableReason(plan: EnhancementPlan): string | null {
  const gaps = missingAreas(plan.coverage).map((area) => area.label);
  const needed = requiresFunctionalCheck(plan.kind);
  if (needed !== null && !plan.functionalChecks.some((check) => check.kind === needed)) {
    gaps.push(`a live ${needed} check`);
  }
  return gaps.length === 0 ? null : `This plan does not cover: ${gaps.join(', ')}. Plan it again.`;
}

async function claimJob(
  deps: EnhancementDeps,
  input: { projectId: string; ownerId: string; planId: string; instruction: string },
): Promise<EditJob> {
  try {
    return await deps.store.createJob({ ...input, kind: 'ENHANCEMENT' });
  } catch (error) {
    if (error instanceof deps.store.ActiveEditExists) throw AppError.conflict(BUSY);
    throw error;
  }
}

export async function applyEnhancement(
  input: { projectId: string; ownerId: string; planId: string },
  deps: EnhancementDeps,
): Promise<EditJob> {
  const entry = planOrThrow(input.planId, input.ownerId, input.projectId);
  const { plan } = entry;
  if (plan.status !== 'planned') throw AppError.conflict(`This plan is already ${plan.status}.`);
  const unappliable = unappliableReason(plan);
  if (unappliable !== null) throw AppError.conflict(unappliable);

  const project = await deps.project(input.ownerId, input.projectId);
  if (await deps.store.activeJobFor(input.projectId)) throw AppError.conflict(BUSY);
  if ((await deps.latestRunId(input.projectId)) !== plan.basedOnRunId) {
    throw AppError.conflict(
      'The project has changed since this was planned. Plan it again so it starts from the current files.',
    );
  }

  // The unique index decides between two requests that both got this far.
  const job = await claimJob(deps, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    planId: plan.planId,
    instruction: plan.instruction,
  });
  plan.status = 'applying';
  // Attributed to this job only: a retry after a cancel did not pay for them again.
  const planUsage = entry.usage;
  entry.usage = [];

  const abort = new AbortController();
  running.set(job.id, abort);
  withLogContext({ jobId: job.id, projectId: input.projectId }, () => {
    void runEnhancementJob(
      {
        jobId: job.id,
        ownerId: input.ownerId,
        plan,
        artifacts: entry.artifacts,
        planUsage,
        research: entry.research,
        projectName: project.name,
        signal: abort.signal,
      },
      deps,
    )
      .then((status) => {
        plan.status = status;
      })
      .finally(() => running.delete(job.id));
  });
  return job;
}

/** The enhancement job, or the same 404 for missing, not-yours and wrong-project. */
async function ownedJob(
  deps: EnhancementDeps,
  input: { projectId: string; ownerId: string; jobId: string },
): Promise<EditJob> {
  const job = await deps.store.getJob(input.jobId, input.ownerId);
  if (job?.projectId !== input.projectId || job.kind !== 'ENHANCEMENT') {
    throw AppError.notFound('That enhancement job does not exist');
  }
  return job;
}

export async function getEnhancementJob(
  input: { projectId: string; ownerId: string; jobId: string },
  deps: EnhancementDeps,
): Promise<EditJob> {
  return ownedJob(deps, input);
}

export async function currentEnhancementJob(
  input: { projectId: string; ownerId: string },
  deps: EnhancementDeps,
): Promise<EditJob | null> {
  await deps.project(input.ownerId, input.projectId);
  const active = await deps.store.activeJobFor(input.projectId);
  if (active?.ownerId === input.ownerId && active.kind === 'ENHANCEMENT') return active;
  return deps.store.latestJobFor(input.projectId, input.ownerId, 'ENHANCEMENT');
}

export async function cancelEnhancement(
  input: { projectId: string; ownerId: string; jobId: string },
  deps: EnhancementDeps,
): Promise<EditJob> {
  await ownedJob(deps, input);
  if (!(await deps.store.requestCancel(input.jobId))) {
    throw AppError.conflict('That enhancement has already finished, so it cannot be cancelled.');
  }
  running.get(input.jobId)?.abort();
  return ownedJob(deps, input);
}

/** What is on record about the restored files, in words that claim no more. */
export function restoredVerificationNote(
  restored: Partial<Pick<PipelineArtifacts, 'verification'>>,
): string {
  const base = 'A revert restores stored files and does not rebuild them.';
  const result = restored.verification?.result;
  if (!result) return `${base} No verification result was recorded for that version.`;
  if (result.ok) return `${base} The record stored with that version says verification passed.`;
  const failed = result.steps.filter((step) => step.status === 'failed').map((step) => step.id);
  return `${base} The record stored with that version says verification did not pass${
    failed.length === 0 ? '' : ` (${failed.join(', ')} failed)`
  }.`;
}

function revertStage(summary: string): PipelineStage {
  const now = new Date().toISOString();
  return {
    id: 'enhancement',
    label: 'Enhancement reverted',
    status: 'completed',
    engine: 'deterministic',
    agentId: 'enhancement-engineer',
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    summary,
    error: null,
    degraded: false,
  };
}

/**
 * Restores the files from before an enhancement, as a new version.
 *
 * History is kept: this adds a run holding the older files. It only works on
 * the project's newest version, because restoring an older baseline after
 * later changes would silently discard those too.
 */
export async function revertEnhancement(
  input: { projectId: string; ownerId: string; jobId: string },
  deps: EnhancementDeps,
): Promise<{ runId: string; restoredRunId: string }> {
  const target = await ownedJob(deps, input);
  const baseRunId = (target.result as EnhancementResult | null)?.baseRunId;
  if (target.status !== 'SUCCEEDED' || target.runId === null || baseRunId === undefined) {
    throw AppError.conflict('Only an enhancement that was applied can be reverted.');
  }
  if (await deps.store.activeJobFor(input.projectId)) throw AppError.conflict(BUSY);
  if ((await deps.latestRunId(input.projectId)) !== target.runId) {
    throw AppError.conflict(
      'This is no longer the latest version of the project, so reverting it would also discard later changes.',
    );
  }
  const [restored, current, project] = await Promise.all([
    deps.loadRun(baseRunId),
    deps.loadRun(target.runId),
    deps.project(input.ownerId, input.projectId),
  ]);
  if (!restored || !current) {
    throw AppError.conflict('The stored files for that version are no longer available.');
  }

  const job = await claimJob(deps, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    planId: `revert:${target.id}`,
    instruction: `Revert: ${target.instruction}`.slice(0, 2_000),
  });
  const reporter = new JobReporter(deps, input.projectId, job.id);
  reporter.emit('job.started', 'Revert started', 'started', {
    data: { title: job.instruction.slice(0, 120) },
  });

  try {
    const registered = await deps.registerRun({
      projectId: input.projectId,
      projectName: project.name,
      ownerId: input.ownerId,
      prompt: job.instruction,
      artifacts: restored,
      stages: [revertStage(`Restored the files from run ${baseRunId}`)],
      ai: {
        calls: 0,
        provider: 'none',
        model: 'none',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      },
    });
    if (!registered.persisted) throw new Error('The restored files could not be stored.');
    const { run } = registered;

    const limitations: string[] = [restoredVerificationNote(restored)];
    try {
      await deps.syncGraph(input.projectId, run.id, { ...restored, runId: run.id });
    } catch (error) {
      limitations.push('The Knowledge Graph could not be refreshed for this version.');
      logger.warn('graph could not be synchronized after a revert', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const diff = fullDiff(
      current.files,
      new Map(restored.files.map((file) => [file.path, file.content])),
    );
    const outcome = `Reverted: the project is back to the files from before this enhancement (${String(diff.changed.length)} files restored).`;
    const result: EnhancementResult = {
      planId: job.planId,
      projectId: input.projectId,
      status: 'applied',
      runId: run.id,
      // The version just left, so a revert can itself be undone.
      baseRunId: target.runId,
      kind: (target.result as EnhancementResult).kind,
      changedFiles: diff.changed,
      unchangedFileCount: restored.files.length - diff.changed.length + diff.deleted.length,
      outcome,
      rolledBack: false,
      completedAt: new Date().toISOString(),
      verification: { ran: false, ok: false, steps: [], failedRoutes: [] },
      repair: { attempted: 0, repaired: false, restoredUnplannedFiles: [] },
      functionalChecks: [],
      coverage: [],
      plannedButUnchanged: [],
      limitations,
      usage: { calls: 0, inputTokens: null, outputTokens: null, costUsd: null },
    };
    await deps.store.finishJob(job.id, {
      status: 'SUCCEEDED',
      result: storable(result),
      runId: run.id,
      detail: outcome,
    });
    reporter.emit('enhancement.reverted', outcome, 'succeeded', {
      data: { runId: run.id, restoredRunId: baseRunId },
    });
    reporter.terminal('job.completed', outcome, 'succeeded', { data: { runId: run.id } });
    return { runId: run.id, restoredRunId: baseRunId };
  } catch (error) {
    const reason = redactString(error instanceof Error ? error.message : String(error));
    const message = `${reason} The project was not changed.`;
    await deps.store.finishJob(job.id, {
      status: 'FAILED',
      error: message,
      detail: 'the revert failed',
    });
    reporter.terminal('job.failed', message, 'failed', { data: { error: message } });
    throw AppError.conflict(message);
  }
}
