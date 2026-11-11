/**
 * Runs an approved plan to a verdict.
 *
 * Nothing is stored as the project's state until the very end. The changed
 * files live in a private working copy while they are built and exercised, so
 * a failure, a rejection or a cancel at any point leaves the project exactly
 * as it was, and the run that holds the original files is untouched anyway.
 */
import { logger } from '../../../shared/logger/index.js';
import { redactString } from '../../../shared/security/redact.js';
import { changedFilesBetween } from '../../project-editor/project-editor.service.js';
import type { ChangedFile } from '../../project-editor/project-editor.types.js';
import type { PipelineArtifacts, PipelineStage } from '../../pipeline/pipeline.types.js';
import type { RepairResult, VerificationResult } from '../../build-verification/index.js';
import type {
  EnhancementOverlay,
  EnhancementPlan,
  EnhancementResult,
  EnhancementStatus,
  FunctionalCheckResult,
  ModelCallUsage,
  PlanRecordResearch,
} from '../enhancement.types.js';
import {
  capabilityGoesUntested,
  disconnectedFrontendReason,
  evaluateCoverage,
  missingAreas,
  requiresFunctionalCheck,
} from './coverage.js';
import type { EnhancementDeps } from './deps.js';
import { RunCapacityUnavailable } from '../../agent-orchestrator/lib/runtime-validation.js';
import { baselineRepairPermits } from './baseline-repair.js';
import { addedDependencies } from './dependency-changes.js';
import { implementFile } from './implementer.js';
import { JobReporter } from './job-reporter.js';
import { modelCaller, runAiSummary, usageTotals } from './usage.js';

const HEARTBEAT_MS = 60_000;
const ENGINEER = 'enhancement-engineer' as const;
const VERIFIER = 'build-verification';

export class EnhancementCancelled extends Error {}

export interface WorkerInput {
  jobId: string;
  ownerId: string;
  plan: EnhancementPlan;
  artifacts: PipelineArtifacts;
  planUsage: readonly ModelCallUsage[];
  research: PlanRecordResearch | null;
  projectName: string;
  signal: AbortSignal;
}

interface WorkingState {
  workspace: Map<string, string>;
  changed: ChangedFile[];
  deleted: string[];
  verification: VerificationResult | null;
  repair: RepairResult | null;
  restored: string[];
  baselineRepairs: { path: string; reason: string }[];
  initialFailures: { id: string; status: string; summary: string }[];
  functional: FunctionalCheckResult[];
  limitations: string[];
}

export function filesOf(
  workspace: ReadonlyMap<string, string>,
): { path: string; content: string }[] {
  return [...workspace.entries()].map(([path, content]) => ({ path, content }));
}

/** Everything that differs from the baseline, removed files included. */
export function fullDiff(
  baseline: readonly { path: string; content: string }[],
  workspace: ReadonlyMap<string, string>,
): { changed: ChangedFile[]; deleted: string[] } {
  const deleted = baseline.filter((file) => !workspace.has(file.path));
  return {
    changed: [
      ...changedFilesBetween(baseline, filesOf(workspace)),
      ...deleted.map((file) => ({
        path: file.path,
        addedLines: 0,
        removedLines: file.content.split('\n').length,
        hunks: [],
      })),
    ],
    deleted: deleted.map((file) => file.path),
  };
}

/**
 * Puts back anything a repair changed outside the plan.
 *
 * The plan is what the person agreed to, so a repair reaching for another file
 * is not allowed to keep that change just because it made the build pass. The
 * one exception, `permitted`, is a file already failing before this change; it
 * is decided by `baselineRepairPermits`, on evidence, and reported.
 */
export function restoreUnplanned(
  planned: ReadonlySet<string>,
  baseline: readonly { path: string; content: string }[],
  repaired: readonly { path: string; content: string }[],
  permitted: ReadonlyMap<string, string> = new Map(),
): { workspace: Map<string, string>; restored: string[] } {
  const original = new Map(baseline.map((file) => [file.path, file.content]));
  const workspace = new Map<string, string>();
  const restored: string[] = [];
  for (const file of repaired) {
    if (
      planned.has(file.path) ||
      permitted.has(file.path) ||
      original.get(file.path) === file.content
    ) {
      workspace.set(file.path, file.content);
    } else {
      restored.push(file.path);
      const before = original.get(file.path);
      if (before !== undefined) workspace.set(file.path, before);
    }
  }
  for (const [path, content] of original) {
    if (!workspace.has(path) && !planned.has(path)) {
      workspace.set(path, content);
      restored.push(path);
    }
  }
  return { workspace, restored };
}

/** One readable reason this result cannot be accepted, or null when it can. */
export function rejectionReason(input: {
  plan: Pick<EnhancementPlan, 'kind'>;
  verification: VerificationResult | null;
  functional: readonly FunctionalCheckResult[];
  changedPaths: readonly string[];
  baselinePaths: readonly string[];
}): string | null {
  if (input.changedPaths.length === 0) return 'The plan produced no file changes.';
  if (!input.verification?.ok) {
    const failed = (input.verification?.steps ?? [])
      .filter((step) => step.status === 'failed')
      .map((step) => step.id);
    return `Verification did not pass${failed.length === 0 ? '' : ` (${failed.join(', ')} failed)`}.`;
  }
  const needed = requiresFunctionalCheck(input.plan.kind);
  if (needed !== null && !input.functional.some((check) => check.kind === needed)) {
    return `The required ${needed} round trip did not run.`;
  }
  const broken = input.functional.filter((check) => !check.passed);
  if (broken.length > 0) {
    return `Live checks failed: ${broken.map((check) => check.label).join('; ')}.`;
  }
  const gaps = missingAreas(
    evaluateCoverage(input.plan.kind, input.changedPaths, input.baselinePaths),
  );
  if (gaps.length > 0) {
    return `The change did not touch: ${gaps.map((area) => area.label).join(', ')}.`;
  }
  return null;
}

/** A plan built on web content does not get to choose what this server installs. */
function researchedDependencyRefusal(input: WorkerInput, state: WorkingState): string | null {
  if (input.plan.research.outcome !== 'ran') return null;
  const added = addedDependencies(input.artifacts.files, state.workspace);
  if (added.length === 0) return null;
  return `This plan used web research and added packages, which is not allowed without review: ${added.slice(0, 10).join(', ')}.`;
}

async function checkpoint(input: WorkerInput, deps: EnhancementDeps): Promise<void> {
  if (input.signal.aborted || (await deps.store.isCancelRequested(input.jobId))) {
    throw new EnhancementCancelled('Cancelled at your request.');
  }
}

async function implement(
  input: WorkerInput,
  deps: EnhancementDeps,
  reporter: JobReporter,
  state: WorkingState,
): Promise<void> {
  await reporter.enterStage('implementing', ENGINEER);
  const call = modelCaller(deps.generate, (usage) => {
    reporter.recordCall(usage);
  });
  const changedSoFar: string[] = [];
  const plannedPaths = new Set(input.plan.files.map((file) => file.path));
  for (const file of input.plan.files) {
    await checkpoint(input, deps);
    const startedAt = Date.now();
    reporter.emit('agent.started', `Working on ${file.path}`, 'started', {
      stage: 'implementing',
      agentId: ENGINEER,
      data: { task: file.path },
    });
    try {
      const done = await implementFile({
        plan: input.plan,
        file,
        workspace: state.workspace,
        changedSoFar,
        call,
        plannedPaths,
      });
      if (done.content === null) state.workspace.delete(done.path);
      else state.workspace.set(done.path, done.content);
      changedSoFar.push(done.path);
      reporter.emit('agent.completed', `Finished ${file.path}`, 'succeeded', {
        stage: 'implementing',
        agentId: ENGINEER,
        data: { durationMs: Date.now() - startedAt, artifacts: [file.path] },
      });
    } catch (error) {
      reporter.emit('agent.failed', `Could not change ${file.path}`, 'failed', {
        stage: 'implementing',
        agentId: ENGINEER,
        data: {
          durationMs: Date.now() - startedAt,
          error: redactString(error instanceof Error ? error.message : String(error)),
        },
      });
      throw error;
    }
  }
  const baseline = new Set(input.artifacts.files.map((file) => file.path));
  const diff = fullDiff(input.artifacts.files, state.workspace);
  state.changed = diff.changed;
  state.deleted = diff.deleted;
  reporter.emit('files.changed', `${String(diff.changed.length)} files changed`, 'info', {
    stage: 'implementing',
    data: {
      created: diff.changed
        .map((file) => file.path)
        .filter((path) => !baseline.has(path))
        .slice(0, 200),
      modified: diff.changed
        .map((file) => file.path)
        .filter((path) => baseline.has(path) && !diff.deleted.includes(path))
        .slice(0, 200),
      deleted: diff.deleted.slice(0, 200),
    },
  });
}

/** GET routes only: a POST with no body proves nothing about the route. */
function routesToProbe(plan: EnhancementPlan): { method: string; path: string }[] {
  const routes: { method: string; path: string }[] = [];
  for (const check of plan.functionalChecks) {
    const endpoint =
      check.kind === 'auth' ? check.protected : { method: 'GET', path: check.collectionPath };
    if (endpoint.method === 'GET') routes.push(endpoint);
  }
  return routes;
}

async function verifyAndRepair(
  input: WorkerInput,
  deps: EnhancementDeps,
  reporter: JobReporter,
  state: WorkingState,
): Promise<void> {
  const options = {
    projectId: input.plan.projectId,
    jobId: input.jobId,
    jobKind: 'ENHANCEMENT' as const,
    routes: routesToProbe(input.plan),
    signal: input.signal,
  };
  await checkpoint(input, deps);
  await reporter.enterStage('testing', VERIFIER, `${String(state.changed.length)} files changed`);
  state.verification = await deps.verify(filesOf(state.workspace), options);
  state.limitations.push(...state.verification.limitations);
  if (state.verification.ok) return;

  await checkpoint(input, deps);
  await reporter.enterStage('repairing', 'build-repair', 'verification failed');
  const failing = state.verification;
  state.initialFailures = failing.steps
    .filter((step) => step.status !== 'passed' && step.status !== 'skipped')
    .map((step) => ({ id: step.id, status: step.status, summary: step.summary }));
  state.repair = await deps.repair(filesOf(state.workspace), failing, options);
  state.limitations.push(...state.repair.limitations);
  reporter.addRepairUsage(state.repair.usage);

  const planned = new Set(input.plan.files.map((file) => file.path));
  const permits = baselineRepairPermits({
    planned,
    baseline: input.artifacts.files,
    repaired: state.repair.files,
    failing,
    storedBaseline: input.artifacts.verification?.result,
    changedByPlan: new Set(state.changed.map((file) => file.path)),
  });
  const scoped = restoreUnplanned(planned, input.artifacts.files, state.repair.files, permits);
  state.workspace = scoped.workspace;
  state.restored = scoped.restored;
  state.verification = state.repair.verification;
  for (const [path, reason] of permits) {
    state.baselineRepairs.push({ path, reason });
    state.limitations.push(`${path} was changed outside the plan to repair the build: ${reason}`);
  }

  if (scoped.restored.length > 0) {
    // Entering the next stage would close this one as succeeded.
    if (!state.repair.repaired) reporter.failStage('the repair did not fix the project');
    // The verdict on the repaired set no longer describes these files, so it
    // cannot be reused. Measure what will actually be delivered.
    state.limitations.push(
      `A repair changed files outside the plan, and they were put back: ${scoped.restored.join(', ')}.`,
    );
    await checkpoint(input, deps);
    await reporter.enterStage('testing', VERIFIER, 'repair went outside the plan');
    state.verification = await deps.verify(filesOf(state.workspace), options);
    state.limitations.push(...state.verification.limitations);
  }
  const diff = fullDiff(input.artifacts.files, state.workspace);
  state.changed = diff.changed;
  state.deleted = diff.deleted;
}

async function runLiveChecks(
  input: WorkerInput,
  deps: EnhancementDeps,
  reporter: JobReporter,
  state: WorkingState,
): Promise<void> {
  if (input.plan.functionalChecks.length === 0) {
    state.limitations.push(
      'No live round trip ran for this change, so the result rests on the start, health and route checks above and the new behaviour itself was not tested.',
    );
    return;
  }
  await checkpoint(input, deps);
  const startedAt = Date.now();
  let sessionId: string | null = null;
  try {
    const runtime = await deps.validate({
      projectId: input.plan.projectId,
      runId: input.jobId,
      projectName: input.projectName,
      files: filesOf(state.workspace),
      signal: input.signal,
    });
    sessionId = runtime.sessionId;
    if (runtime.baseUrls.backend === null) {
      state.limitations.push(
        'The backend did not come up for the live checks, so they did not run.',
      );
      return;
    }
    state.functional = await deps.runChecks(runtime.baseUrls.backend, input.plan.functionalChecks, {
      signal: input.signal,
    });
    for (const result of state.functional) {
      state.limitations.push(...result.limitations);
      reporter.emit('verify.check', result.label, result.passed ? 'succeeded' : 'failed', {
        stage: 'testing',
        data: {
          id: `functional-${result.kind}`,
          durationMs: Date.now() - startedAt,
          summary: `${String(result.steps.filter((step) => step.passed).length)} of ${String(result.steps.length)} steps passed`,
        },
      });
    }
  } catch (error) {
    if (!(error instanceof RunCapacityUnavailable)) throw error;
    // Work that already passed verification is not thrown away as a failure.
    // A required round trip that could not run still blocks acceptance below.
    state.limitations.push(error.message);
  } finally {
    if (sessionId !== null) {
      try {
        deps.stop(sessionId);
      } catch (error) {
        logger.warn('enhancement validation session could not be stopped', { sessionId, error });
      }
    }
  }
}

function resultOf(
  input: WorkerInput,
  state: WorkingState,
  reporter: JobReporter,
  verdict: { status: EnhancementStatus; outcome: string; runId: string | null },
): EnhancementResult {
  const changedPaths = state.changed.map((file) => file.path);
  const changedSet = new Set(changedPaths);
  const verification = state.verification;
  return {
    planId: input.plan.planId,
    projectId: input.plan.projectId,
    status: verdict.status,
    runId: verdict.runId,
    baseRunId: input.plan.basedOnRunId,
    kind: input.plan.kind,
    changedFiles: state.changed,
    unchangedFileCount: state.workspace.size - changedPaths.length + state.deleted.length,
    outcome: verdict.outcome,
    rolledBack: verdict.status !== 'applied',
    completedAt: new Date().toISOString(),
    verification: {
      ran: verification !== null,
      ok: verification?.ok ?? false,
      steps: (verification?.steps ?? []).map((step) => ({
        id: step.id,
        status: step.status,
        command: step.command,
        exitCode: step.exitCode,
        durationMs: step.durationMs,
        summary: step.summary,
        reason: step.reason,
      })),
      failedRoutes: (verification?.routes ?? [])
        .filter((route) => route.status === 'failed')
        .map((route) => `${route.method} ${route.path}`),
    },
    repair: {
      attempted: state.repair?.attempts.length ?? 0,
      repaired: state.repair?.repaired ?? false,
      restoredUnplannedFiles: state.restored,
      ...(state.baselineRepairs.length > 0 ? { baselineRepairs: state.baselineRepairs } : {}),
      ...(state.initialFailures.length > 0 ? { initialFailures: state.initialFailures } : {}),
    },
    functionalChecks: state.functional,
    coverage: evaluateCoverage(
      input.plan.kind,
      changedPaths,
      input.artifacts.files.map((file) => file.path),
    ),
    plannedButUnchanged: input.plan.files
      .map((file) => file.path)
      .filter((path) => !changedSet.has(path)),
    limitations: [...new Set(state.limitations)],
    usage: usageTotals(reporter.usage),
  };
}

const MAX_STORED_FILES = 40;
const MAX_STORED_HUNKS = 30;

/** The row is re-sent on every poll, and step output can quote a connection string. */
export function storable(result: EnhancementResult): EnhancementResult {
  return {
    ...result,
    changedFiles: result.changedFiles
      .slice(0, MAX_STORED_FILES)
      .map((file) => ({ ...file, hunks: file.hunks.slice(0, MAX_STORED_HUNKS) })),
    outcome: redactString(result.outcome),
    limitations: result.limitations.map((entry) => redactString(entry)),
    verification: {
      ...result.verification,
      steps: result.verification.steps.map((step) => ({
        ...step,
        summary: redactString(step.summary),
      })),
    },
  };
}

function overlayFor(
  artifacts: PipelineArtifacts,
  workspace: ReadonlyMap<string, string>,
  changed: readonly ChangedFile[],
  deleted: readonly string[],
): EnhancementOverlay {
  const previous = (artifacts as PipelineArtifacts & { enhancement?: EnhancementOverlay })
    .enhancement;
  const overridden = new Set([
    ...(previous?.overriddenPaths ?? []),
    ...changed.map((file) => file.path),
  ]);
  const removed = new Set([...(previous?.removedPaths ?? []), ...deleted]);
  for (const path of deleted) overridden.delete(path);
  for (const path of workspace.keys()) removed.delete(path);
  return { overriddenPaths: [...overridden], removedPaths: [...removed] };
}

async function persist(
  input: WorkerInput,
  deps: EnhancementDeps,
  reporter: JobReporter,
  state: WorkingState,
): Promise<string> {
  const now = new Date().toISOString();
  const stages: PipelineStage[] = [
    {
      id: 'enhancement',
      label: 'Enhancement applied',
      status: 'completed',
      engine: 'ai',
      agentId: ENGINEER,
      startedAt: input.plan.createdAt,
      completedAt: now,
      durationMs: null,
      summary: `${String(state.changed.length)} files changed · ${input.plan.summary}`,
      error: null,
      degraded: false,
    },
  ];
  const artifacts = {
    ...input.artifacts,
    files: filesOf(state.workspace),
    enhancement: overlayFor(input.artifacts, state.workspace, state.changed, state.deleted),
    // Fresh research went only to this plan. Keeping the base build's list
    // would claim the new evidence fed stages that never saw it.
    ...(input.research
      ? {
          research: input.research.artifact,
          researchAppliedTo: ['enhancement-plan' as const],
        }
      : {}),
    // The base build's verdict described the files this replaces.
    ...(state.verification
      ? {
          verification: {
            result: state.verification,
            repairAttempts: state.repair?.attempts.length ?? 0,
            repaired: state.repair?.repaired ?? false,
            limitations: [...new Set(state.limitations)],
          },
        }
      : {}),
  };
  const { run, persisted } = await deps.registerRun({
    projectId: input.plan.projectId,
    projectName: input.projectName,
    ownerId: input.ownerId,
    prompt: input.plan.instruction,
    artifacts,
    stages,
    ai: runAiSummary(reporter.usage),
  });
  if (!persisted) {
    throw new Error(
      'The change passed its checks, but its files could not be stored, so it was not applied.',
    );
  }
  try {
    await deps.syncGraph(input.plan.projectId, run.id, { ...artifacts, runId: run.id });
  } catch (error) {
    state.limitations.push('The Knowledge Graph could not be refreshed for this version.');
    logger.warn('graph could not be synchronized after an enhancement', {
      projectId: input.plan.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return run.id;
}

/** Replays what happened before the job existed, marked as such. */
function reportPlanningPhase(input: WorkerInput, reporter: JobReporter): void {
  const replay = { replayed: true, occurredAt: input.plan.createdAt };
  for (const call of input.planUsage) reporter.replayPlanningCall(call, input.plan.createdAt);
  reporter.emit('enhancement.planned', input.plan.summary, 'info', {
    stage: 'planning',
    data: { planId: input.plan.planId, files: input.plan.filesLikelyTouched },
  });
  if (input.research) {
    for (const query of input.research.artifact.queries) {
      reporter.emit('research.query', query.query, 'info', {
        stage: 'research',
        data: { provider: query.provider, query: query.query, results: query.results, ...replay },
      });
    }
    for (const source of input.research.artifact.sources) {
      reporter.emit('research.source', source.title, 'info', {
        stage: 'research',
        data: { url: source.url, title: source.title, retrieval: source.retrievalKind, ...replay },
      });
    }
  }
  for (const detail of input.plan.research.limitations) {
    reporter.emit('research.limitation', detail, 'info', { stage: 'research', data: { detail } });
  }
}

/** Runs to a settled job on every path. Resolves to how the plan should be left. */
export async function runEnhancementJob(
  input: WorkerInput,
  deps: EnhancementDeps,
): Promise<EnhancementPlan['status']> {
  const reporter = new JobReporter(deps, input.plan.projectId, input.jobId);
  const state: WorkingState = {
    workspace: new Map(input.artifacts.files.map((file) => [file.path, file.content])),
    changed: [],
    deleted: [],
    verification: null,
    repair: null,
    restored: [],
    baselineRepairs: [],
    initialFailures: [],
    functional: [],
    limitations: [...input.plan.limitations],
  };
  const startedAt = Date.now();
  const pulse = setInterval(() => {
    void deps.store.heartbeat(input.jobId);
  }, HEARTBEAT_MS);
  pulse.unref();
  let appliedRunId: string | null = null;

  reporter.emit('job.started', 'Enhancement started', 'started', {
    data: { title: input.plan.instruction.slice(0, 120) },
  });

  try {
    reportPlanningPhase(input, reporter);
    await implement(input, deps, reporter, state);
    // Before verification, which installs them.
    const refusedPackages = researchedDependencyRefusal(input, state);
    if (refusedPackages === null) {
      await verifyAndRepair(input, deps, reporter, state);
      if (state.verification?.ok) await runLiveChecks(input, deps, reporter, state);
    }
    const added = addedDependencies(input.artifacts.files, state.workspace);
    if (added.length > 0) state.limitations.push(`Packages added: ${added.join(', ')}.`);

    const changedFrontend = state.changed.flatMap((file) => {
      const content = state.workspace.get(file.path);
      return content !== undefined && file.path.startsWith('frontend/')
        ? [{ path: file.path, content }]
        : [];
    });
    const reason =
      refusedPackages ??
      rejectionReason({
        plan: input.plan,
        verification: state.verification,
        functional: state.functional,
        changedPaths: state.changed.map((file) => file.path),
        baselinePaths: input.artifacts.files.map((file) => file.path),
      }) ??
      disconnectedFrontendReason(input.plan.kind, input.plan.functionalChecks, changedFrontend);
    await checkpoint(input, deps);

    let refusal = reason;
    if (
      refusal === null &&
      (await deps.latestRunId(input.plan.projectId)) !== input.plan.basedOnRunId
    ) {
      refusal =
        'The project changed while this was running, so it was not applied over the newer version.';
    }
    // Declared dead while it worked (a laptop suspend does this): the slot is
    // gone and the job.interrupted event is out, so this verdict must not land.
    const row = await deps.store.getJob(input.jobId, input.ownerId);
    if (row !== null && row.status !== 'QUEUED' && row.status !== 'RUNNING') {
      reporter.failStage('the job was settled elsewhere');
      logger.warn('enhancement result discarded: its job was already settled', {
        jobId: input.jobId,
        status: row.status,
      });
      return 'planned';
    }
    if (refusal !== null) {
      const outcome = `${refusal} The project keeps the files it had.`;
      reporter.failStage(refusal);
      await deps.store.finishJob(input.jobId, {
        status: 'REJECTED',
        result: storable(
          resultOf(input, state, reporter, { status: 'rejected', outcome, runId: null }),
        ),
        detail: outcome,
      });
      reporter.terminal('job.failed', outcome, 'failed', { data: { error: outcome } });
      return 'rejected';
    }

    appliedRunId = await persist(input, deps, reporter, state);
    reporter.closeStage();
    const untested = capabilityGoesUntested(input.plan.kind, state.functional.length)
      ? ' The capability itself was not checked.'
      : '';
    const outcome = `Applied: ${String(state.changed.length)} files changed and verification passed.${untested}`;
    await deps.store.finishJob(input.jobId, {
      status: 'SUCCEEDED',
      result: storable(
        resultOf(input, state, reporter, { status: 'applied', outcome, runId: appliedRunId }),
      ),
      runId: appliedRunId,
      detail: outcome,
    });
    reporter.emit('enhancement.applied', outcome, 'succeeded', {
      data: { runId: appliedRunId, changedFiles: state.changed.length },
    });
    reporter.terminal('job.completed', outcome, 'succeeded', {
      data: { runId: appliedRunId, durationMs: Date.now() - startedAt },
    });
    return 'applied';
  } catch (error) {
    const cancelled = error instanceof EnhancementCancelled || input.signal.aborted;
    if (cancelled && appliedRunId === null) {
      const stage = reporter.failStage('cancelled') ?? undefined;
      const outcome = 'Cancelled. The project keeps the files it had.';
      await deps.store.finishJob(input.jobId, {
        status: 'CANCELLED',
        result: storable(
          resultOf(input, state, reporter, { status: 'cancelled', outcome, runId: null }),
        ),
        detail: outcome,
      });
      reporter.terminal('job.cancelled', outcome, 'cancelled', stage ? { stage } : {});
      return 'planned';
    }
    const reason = redactString(error instanceof Error ? error.message : String(error));
    const stage = reporter.failStage(reason) ?? undefined;
    logger.warn('enhancement job failed', { jobId: input.jobId, reason });
    // After the run was stored the project HAS changed, so saying otherwise
    // would be false. Only the bookkeeping after it can have failed.
    const message =
      appliedRunId === null
        ? `${reason} The project was not changed.`
        : `${reason} The change was stored.`;
    await deps.store.finishJob(input.jobId, {
      status: appliedRunId === null ? 'FAILED' : 'SUCCEEDED',
      error: message,
      runId: appliedRunId,
      detail: 'the enhancement could not be completed',
    });
    reporter.terminal(
      appliedRunId === null ? 'job.failed' : 'job.completed',
      message,
      appliedRunId === null ? 'failed' : 'succeeded',
      { ...(stage ? { stage } : {}), data: { error: message } },
    );
    return appliedRunId === null ? 'planned' : 'applied';
  } finally {
    clearInterval(pulse);
  }
}
