/**
 * Repair, once validation has verified something is broken.
 *
 * The engine's own checks (typecheck, contract, manifest) say a patch is
 * plausible; they cannot say the application works. So an accepted repair is
 * proved here by the same agents that found the failure: the old process is
 * stopped, the project is rebuilt and restarted, and every route is hit again.
 *
 * The verdict is a comparison of two measured validations. A repair that does
 * not measurably improve the result is rolled back, and only a project that
 * then passes the gate becomes the version Preview shows.
 */
import { randomUUID } from 'node:crypto';

import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { logger } from '../../../shared/logger/index.js';
import { loadRunArtifactsForProject } from '../../pipeline/lib/run-artifact-store.js';
import { listRunsForProject } from '../../pipeline/lib/run-store.js';
import { getProjectOrThrow } from '../../workspace/workspace.service.js';
import { latestArtifact, writeArtifact } from './artifact-store.js';
import { executeAgent } from './executor.js';
import { findingKey, listFindings, setFindingRepairState } from './finding-store.js';
import { classifyFinding } from './repair-eligibility.js';
import { RepairSessionConflictError, runRepairSession } from './repair-engine.js';
import { repairProducer } from './repair-producer.js';
import { realValidator } from './repair-validator.js';
import { saveSession } from './repair-store.js';
import { activeJobFor } from '../../project-editor/lib/edit-job-store.js';
import { artifactsOf, recordEvent, signalOf, storeArtifacts, touch } from './run-store.js';
import { runnableFiles } from './runnable-project.js';
import { publishForRun, publishModelUse } from './execution-publisher.js';
import { sumUsage } from './agent-usage.js';
import { releaseValidationSession } from './validation-session.js';
import { summarizeValidation } from './validation-summary.js';
import type { RepairDeps } from './repair-engine.js';
import type { ProjectFile } from './runnable-project.js';
import type {
  AgentDefinition,
  AgentFinding,
  AgentId,
  AgentResult,
  AgentUsage,
  ArtifactType,
} from '../../../shared/contracts/index.js';
import { DEFAULT_REPAIR_CONFIG } from '../../../shared/types/repair.js';
import type { RepairSessionState } from '../../../shared/types/repair.js';
import type {
  IntegrationResult,
  RuntimeResult,
  TestCase,
  ValidationGate,
  ValidationSummary,
} from '../../../shared/types/validation.js';
import type { AgentRun, AgentTask } from '../agent-orchestrator.types.js';

const VALIDATORS: readonly AgentId[] = [
  'runtime-engineer',
  'integration-engineer',
  'test-engineer',
];
const FILE_ARTIFACTS: readonly ArtifactType[] = [
  'backend-source',
  'backend-config',
  'frontend-source',
  'frontend-config',
];
const PASSING_GATES: readonly ValidationGate[] = ['PASSED', 'PASSED_WITH_WARNINGS'];
const GATE_RANK: Record<ValidationGate, number> = {
  NOT_VALIDATED: 0,
  VALIDATING: 0,
  FAILED: 1,
  BLOCKED: 2,
  PASSED_WITH_WARNINGS: 3,
  PASSED: 4,
};
const MAX_REPAIRS = 5;
const MAX_REPAIR_MS = 5 * 60_000;
const MAX_ROUTE_EVENTS = 100;

export interface RevalidatedAgent {
  task: AgentTask;
  definition: AgentDefinition;
  result: AgentResult;
}

/** `summary` is null when a validator could not finish, so nothing was proved. */
export interface Revalidation {
  agents: RevalidatedAgent[];
  summary: ValidationSummary | null;
  failure: string | null;
}

export type PersistOutcome =
  { persisted: true; runId: string } | { persisted: false; reason: string };

export type PostRepairOutcome =
  | { status: 'not-needed' | 'no-repair-available' | 'nothing-fixed'; detail: string }
  | { status: 'rolled-back'; detail: string }
  | { status: 'accepted'; detail: string; gate: ValidationGate; persist: PersistOutcome | null };

export interface PostRepairDeps {
  runSession: (run: AgentRun, repair: RepairDeps) => Promise<RepairSessionState>;
  revalidate: (run: AgentRun) => Promise<Revalidation>;
  persist: (run: AgentRun, usage: AgentUsage | null) => Promise<PersistOutcome>;
}

export interface PostRepairContext {
  run: AgentRun;
  reviewVersion: number | undefined;
  /** Writes one re-run validator's result, through the scheduler's own commit. */
  commit: (task: AgentTask, definition: AgentDefinition, result: AgentResult) => void;
  /** Writes the validation summary again, from the reports now in the run. */
  resummarize: () => Promise<void>;
}

/** Rebuilds, restarts and re-probes with the validators that found the failure. */
async function revalidateProject(run: AgentRun): Promise<Revalidation> {
  // The old process still holds the ports and is running the unrepaired code.
  releaseValidationSession(run.id);

  const artifacts = { ...artifactsOf(run.id) };
  const agents: RevalidatedAgent[] = [];
  for (const agentId of VALIDATORS) {
    const task = run.tasks.find((entry) => entry.agentId === agentId);
    const definition = getAgentDefinition(agentId);
    if (!task || !definition || task.status === 'SKIPPED') continue;

    const { result } = await executeAgent(definition, {
      projectId: run.projectId,
      runId: run.id,
      taskId: task.id,
      prompt: run.prompt,
      inputArtifacts: artifacts,
      context: null,
      signal: signalOf(run.id),
    });
    if (result.status !== 'succeeded') {
      return {
        agents,
        summary: null,
        failure: `${definition.name} could not finish: ${result.error ?? 'unknown error'}`,
      };
    }
    Object.assign(artifacts, result.artifacts);
    agents.push({ task, definition, result });
  }

  const testReport = artifacts['test-report'] as { cases?: TestCase[] } | undefined;
  return {
    agents,
    failure: null,
    summary: summarizeValidation({
      projectId: run.projectId,
      runId: run.id,
      runtime: (artifacts['runtime-report'] ?? null) as RuntimeResult | null,
      integration: (artifacts['integration-report'] ?? null) as IntegrationResult | null,
      cases: testReport?.cases ?? [],
      agents: agents.map((entry) => ({
        agentId: entry.task.agentId,
        status: 'COMPLETED' as const,
        durationMs: entry.result.durationMs,
      })),
    }),
  };
}

/**
 * Why these files may not become the project's newest version, or null.
 *
 * The mesh generates its own project rather than starting from a stored one,
 * so promoting its output replaces whatever the latest version holds. That is
 * only acceptable when the latest version is still the plain build this run
 * started beside, and nothing is about to change it.
 */
export function repairPublishRefusal(input: {
  basedOnRunId: string | null | undefined;
  latestRunId: string;
  activeJob: boolean;
  latestWasChanged: boolean;
}): string | null {
  if (input.activeJob) {
    return 'An edit or enhancement is running on this project, so the repaired files were not applied.';
  }
  if (input.basedOnRunId !== input.latestRunId) {
    return 'The project changed while this agent run was working, so the repaired files were not applied over the newer version.';
  }
  if (input.latestWasChanged) {
    return 'The latest version holds edits or enhancements these generated files do not include, so they were not applied over it.';
  }
  return null;
}

/**
 * Records the repaired files as the project's newest run.
 *
 * Preview, Code and history all read the latest completed run, so that is the
 * only record that gets the files to a person. `registerEditedRun` stores them
 * through `saveRunArtifacts` before it registers anything. The newest stored
 * build supplies the parts the mesh has no equivalent for.
 */
async function persistRepairedFiles(
  run: AgentRun,
  usage: AgentUsage | null,
): Promise<PersistOutcome> {
  const builds = await listRunsForProject(run.projectId, 20);
  const latest = builds.find((build) => build.status === 'COMPLETED');
  const base = latest ? await loadRunArtifactsForProject(latest.id, run.projectId) : null;
  if (!base) {
    return {
      persisted: false,
      reason: 'This project has no stored build to record the repaired files against.',
    };
  }

  const artifacts = artifactsOf(run.id);
  const files = runnableFiles(artifacts);
  // Read from the artifacts rather than the flat list, which drops `language`.
  // Source is applied after config, the same precedence the runner gets.
  function generated<T extends { path: string }>(types: readonly ArtifactType[]): T[] {
    const byPath = new Map<string, T>();
    for (const type of types) {
      for (const file of (artifacts[type] as { files?: T[] } | undefined)?.files ?? []) {
        byPath.set(file.path, file);
      }
    }
    return [...byPath.values()];
  }

  const now = new Date().toISOString();
  const project = await getProjectOrThrow(run.ownerId, run.projectId);
  // Loaded here so the mesh does not pull the whole pipeline in at startup.
  const { registerEditedRun } = await import('../../pipeline/pipeline.service.js');

  // As late as possible: re-validation takes minutes and this read is the guard.
  const [newest, activeJob] = await Promise.all([
    listRunsForProject(run.projectId, 20),
    activeJobFor(run.projectId),
  ]);
  const refusal = repairPublishRefusal({
    basedOnRunId: run.basedOnRunId,
    latestRunId: newest.find((build) => build.status === 'COMPLETED')?.id ?? latest?.id ?? '',
    activeJob: activeJob !== null,
    latestWasChanged: base.changedAfterBuild === true || 'enhancement' in base,
  });
  if (refusal !== null) return { persisted: false, reason: refusal };

  const carried = { ...base };
  // That verdict described the files being replaced.
  delete carried.verification;

  const registered = await registerEditedRun({
    projectId: run.projectId,
    projectName: project.name,
    ownerId: run.ownerId,
    prompt: `Verified repair of agent run ${run.id}`,
    artifacts: {
      ...carried,
      backend: { ...base.backend, files: generated(['backend-config', 'backend-source']) },
      frontend: { ...base.frontend, files: generated(['frontend-config', 'frontend-source']) },
      files,
    },
    stages: [
      {
        id: 'frontend',
        label: 'Verified repair applied',
        status: 'completed',
        engine: 'ai',
        agentId: 'repair-engineer',
        startedAt: now,
        completedAt: now,
        durationMs: null,
        summary: 'Repaired files passed a rebuild, restart and route re-check.',
        error: null,
        degraded: false,
      },
    ],
    ai: {
      calls: usage ? 1 : 0,
      provider: usage?.provider ?? 'none',
      model: usage?.model ?? 'none',
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      estimatedCostUsd: usage?.costUsd ?? 0,
    },
  });
  return registered.persisted
    ? { persisted: true, runId: registered.run.id }
    : { persisted: false, reason: 'The repaired files could not be stored.' };
}

const DEFAULT_DEPS: PostRepairDeps = {
  runSession: (run, repair) =>
    runRepairSession(
      run.projectId,
      { maxRepairsPerRun: MAX_REPAIRS, maxDurationMs: MAX_REPAIR_MS },
      repair,
    ),
  revalidate: revalidateProject,
  persist: persistRepairedFiles,
};

function failureCount(summary: ValidationSummary): number {
  return summary.rows.filter((row) => row.status === 'FAIL').length + summary.tests.failed;
}

/** Better gate with no new failures, or the same gate with fewer of them. */
export function isImproved(before: ValidationSummary, after: ValidationSummary): boolean {
  const gain = GATE_RANK[after.gate] - GATE_RANK[before.gate];
  const fewer = failureCount(before) - failureCount(after);
  return gain > 0 ? fewer >= 0 : gain === 0 && fewer > 0;
}

type FileSnapshot = Partial<Record<ArtifactType, unknown>>;

function captureFiles(projectId: string): FileSnapshot {
  const snapshot: FileSnapshot = {};
  for (const type of FILE_ARTIFACTS) {
    const record = latestArtifact(projectId, type);
    if (record) snapshot[type] = record.content;
  }
  return snapshot;
}

/** The engine writes to the versioned store; the run's own map must follow. */
function syncRunFiles(run: AgentRun): void {
  storeArtifacts(run.id, captureFiles(run.projectId));
}

/** Undoes the session as new versions, so history keeps both directions. */
function restoreFiles(run: AgentRun, snapshot: FileSnapshot): void {
  for (const [key, content] of Object.entries(snapshot)) {
    const type = key as ArtifactType;
    const current = latestArtifact(run.projectId, type);
    if (JSON.stringify(current?.content) === JSON.stringify(content)) continue;
    writeArtifact({
      projectId: run.projectId,
      runId: run.id,
      type,
      agentId: 'repair-engineer',
      agentVersion: getAgentDefinition('repair-engineer')?.version ?? '0',
      derivedFrom: current ? [current.id] : [],
      content,
    });
  }
  storeArtifacts(run.id, snapshot);
}

function changedPaths(
  before: readonly ProjectFile[],
  after: readonly ProjectFile[],
): { created: string[]; modified: string[]; deleted: string[] } {
  const previous = new Map(before.map((file) => [file.path, file.content]));
  const current = new Set(after.map((file) => file.path));
  return {
    created: after.filter((file) => !previous.has(file.path)).map((file) => file.path),
    modified: after
      .filter((file) => previous.has(file.path) && previous.get(file.path) !== file.content)
      .map((file) => file.path),
    deleted: before.filter((file) => !current.has(file.path)).map((file) => file.path),
  };
}

/** The repair appears in the run as a task, because it is work the run did. */
function openRepairTask(run: AgentRun): AgentTask {
  const task: AgentTask = {
    id: randomUUID(),
    projectId: run.projectId,
    runId: run.id,
    agentId: 'repair-engineer',
    status: 'RUNNING',
    priority: 'HIGH',
    inputArtifactTypes: [],
    dependencyTaskIds: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    error: null,
    failureKind: null,
    retryCount: 0,
    summary: null,
    artifactIds: [],
    usage: null,
    findings: [],
  };
  run.tasks.push(task);
  recordEvent(run.id, 'AGENT_STARTED', { taskId: task.id, agentId: task.agentId });
  publishForRun(run, {
    type: 'agent.started',
    status: 'started',
    stage: 'repairing',
    agentId: 'repair-engineer',
    message: 'Repairing the failures validation verified.',
    data: {},
  });
  return task;
}

function closeRepairTask(
  run: AgentRun,
  task: AgentTask,
  usages: readonly (AgentUsage | null)[],
  summary: string,
  error: string | null = null,
): void {
  const startedAt = task.startedAt ? Date.parse(task.startedAt) : Date.now();
  const durationMs = Date.now() - startedAt;
  task.status = error ? 'FAILED' : 'COMPLETED';
  task.completedAt = new Date().toISOString();
  task.durationMs = durationMs;
  task.summary = summary;
  task.error = error;
  task.usage = sumUsage(usages);

  for (const usage of usages) {
    if (!usage) continue;
    run.totals.aiCalls += 1;
    run.totals.inputTokens += usage.inputTokens;
    run.totals.outputTokens += usage.outputTokens;
    run.totals.contextTokens += usage.contextTokens;
    run.totals.costUsd = Number((run.totals.costUsd + usage.costUsd).toFixed(6));
    if (usage.unpricedCalls) {
      run.totals.unpricedCalls = (run.totals.unpricedCalls ?? 0) + usage.unpricedCalls;
    }
  }

  recordEvent(run.id, error ? 'AGENT_FAILED' : 'AGENT_COMPLETED', {
    taskId: task.id,
    agentId: task.agentId,
    detail: error ? { kind: 'internal' } : { durationMs, findings: 0 },
  });
  publishForRun(
    run,
    error
      ? {
          type: 'agent.failed',
          status: 'failed',
          stage: 'repairing',
          agentId: 'repair-engineer',
          message: error,
          data: { durationMs, error },
        }
      : {
          type: 'agent.completed',
          status: 'succeeded',
          stage: 'repairing',
          agentId: 'repair-engineer',
          message: summary,
          data: { durationMs, artifacts: [] },
        },
  );
  touch(run);
}

function publishRepairCompleted(run: AgentRun, attempts: number, repaired: boolean): void {
  publishForRun(run, {
    type: 'repair.completed',
    status: repaired ? 'succeeded' : 'failed',
    stage: 'repairing',
    agentId: 'repair-engineer',
    message: repaired
      ? 'The repaired project passed validation.'
      : 'Repair did not get the project through validation.',
    data: { attempts, repaired },
  });
}

/** One event per route really requested during the re-validation. */
function publishRouteChecks(run: AgentRun, revalidation: Revalidation): void {
  const integration = revalidation.agents.find(
    (entry) => entry.task.agentId === 'integration-engineer',
  )?.result.artifacts['integration-report'] as IntegrationResult | undefined;

  for (const route of (integration?.endpoints ?? []).slice(0, MAX_ROUTE_EVENTS)) {
    const failed = ['MISSING_ENDPOINT', 'SERVER_ERROR', 'NOT_IMPLEMENTED'].includes(route.verdict);
    publishForRun(run, {
      type: 'verify.check',
      status: failed ? 'failed' : 'succeeded',
      stage: 'testing',
      agentId: 'integration-engineer',
      message: `${route.method} ${route.path}: ${route.verdict}`,
      data: {
        id: 'route',
        method: route.method,
        path: route.path,
        actualStatus: route.status,
        expected: 'a declared response',
      },
    });
  }
}

/** A fix the re-validation saw again was not a fix, whatever the engine recorded. */
function rejectReturnedFindings(
  run: AgentRun,
  eligible: ReadonlySet<string>,
  observed: readonly AgentFinding[],
): void {
  const returned = new Set(
    observed.map((finding) =>
      findingKey(
        run.projectId,
        finding.type ?? 'GENERAL',
        finding.category,
        finding.targetFile ?? finding.targetNodeId ?? finding.title,
      ),
    ),
  );
  for (const finding of listFindings(run.projectId)) {
    if (eligible.has(finding.id) && finding.status === 'FIXED' && returned.has(finding.id)) {
      setFindingRepairState(run.projectId, finding.id, 'REJECTED');
    }
  }
}

/**
 * Repairs what validation verified, then proves it by running the app again.
 *
 * Only a FAILED gate qualifies. BLOCKED means something could not be checked,
 * which is not evidence that anything is wrong. Never throws: the run's own
 * result stands whatever happens here.
 */
export async function repairAfterValidation(
  context: PostRepairContext,
  deps: PostRepairDeps = DEFAULT_DEPS,
): Promise<PostRepairOutcome> {
  const { run, reviewVersion } = context;
  const before = artifactsOf(run.id)['validation-summary'] as ValidationSummary | undefined;
  if (before?.gate !== 'FAILED' || signalOf(run.id).aborted) {
    return { status: 'not-needed', detail: 'Validation did not verify a failure.' };
  }

  const eligible = new Set(
    listFindings(run.projectId)
      .filter(
        (finding) =>
          VALIDATORS.includes(finding.agentId) &&
          finding.status === 'OPEN' &&
          finding.lastSeenReview === reviewVersion &&
          classifyFinding(finding).eligibility === 'AUTO_REPAIRABLE',
      )
      .map((finding) => finding.id),
  );
  if (eligible.size === 0) {
    const detail = 'None of the verified failures has a mechanical repair; they need a person.';
    publishForRun(run, {
      type: 'stage.skipped',
      status: 'skipped',
      stage: 'repairing',
      agentId: 'repair-engineer',
      message: detail,
      data: { reason: detail },
    });
    return { status: 'no-repair-available', detail };
  }

  const task = openRepairTask(run);
  const usages: (AgentUsage | null)[] = [];
  const attempts = new Map<string, number>();
  try {
    return await repairWithOpenTask(context, deps, before, eligible, { task, usages, attempts });
  } finally {
    // Whatever threw, a settled run must not show a repair still running.
    if (task.status === 'RUNNING') {
      const detail = 'The repair stopped before it finished.';
      closeRepairTask(run, task, usages, detail, detail);
      publishRepairCompleted(run, sumAttempts(attempts), false);
    }
  }
}

function sumAttempts(attempts: ReadonlyMap<string, number>): number {
  return [...attempts.values()].reduce((sum, count) => sum + count, 0);
}

async function repairWithOpenTask(
  context: PostRepairContext,
  deps: PostRepairDeps,
  before: ValidationSummary,
  eligible: ReadonlySet<string>,
  open: {
    task: AgentTask;
    usages: (AgentUsage | null)[];
    attempts: Map<string, number>;
  },
): Promise<PostRepairOutcome> {
  const { run } = context;
  const { task, usages, attempts } = open;
  const attemptTotal = (): number => sumAttempts(attempts);
  const snapshot = captureFiles(run.projectId);

  const produce = repairProducer({
    ownerId: run.ownerId,
    projectId: run.projectId,
    runId: run.id,
    signal: signalOf(run.id),
    onResult: (usage, durationMs) => {
      usages.push(usage);
      publishModelUse(run, 'repair-engineer', usage, durationMs);
    },
  });

  let session: RepairSessionState;
  try {
    session = await deps.runSession(run, {
      validator: realValidator,
      selectFindings: (finding) => eligible.has(finding.id),
      produce: (finding, rca, plan) => {
        const attempt = (attempts.get(finding.id) ?? 0) + 1;
        attempts.set(finding.id, attempt);
        publishForRun(run, {
          type: 'repair.attempt',
          status: 'running',
          stage: 'repairing',
          agentId: 'repair-engineer',
          message: `Repair attempt ${String(attempt)}: ${finding.title}`,
          data: {
            attempt,
            maxAttempts: DEFAULT_REPAIR_CONFIG.maxAttemptsPerFinding,
            targets: plan.authorizedFiles,
          },
        });
        return produce(finding, rca, plan);
      },
    });
  } catch (error) {
    const detail =
      error instanceof RepairSessionConflictError
        ? 'Another repair session is already running for this project.'
        : 'The repair session could not start.';
    logger.warn('post-validation repair did not run', { runId: run.id, error });
    closeRepairTask(run, task, usages, detail, detail);
    publishRepairCompleted(run, attemptTotal(), false);
    return { status: 'nothing-fixed', detail };
  }

  if (session.counts.fixed === 0) {
    const detail = `No repair survived its checks: ${session.stopReason}`;
    closeRepairTask(run, task, usages, detail);
    publishRepairCompleted(run, attemptTotal(), false);
    return { status: 'nothing-fixed', detail };
  }

  syncRunFiles(run);
  publishForRun(run, {
    type: 'verify.started',
    status: 'started',
    stage: 'testing',
    message: 'Rebuilding, restarting and re-checking routes after the repair.',
    data: { steps: ['install', 'typecheck', 'build', 'start', 'health', 'routes'] },
  });
  const verifyStarted = Date.now();
  // A throw is one more way for re-validation not to finish: the unproven
  // repair must roll back rather than stay in the run's files.
  const revalidation = await deps.revalidate(run).catch((error: unknown): Revalidation => ({
    agents: [],
    summary: null,
    failure: error instanceof Error ? error.message : String(error),
  }));
  const verifyMs = Date.now() - verifyStarted;
  publishRouteChecks(run, revalidation);
  const after = revalidation.summary;

  if (!after || !isImproved(before, after)) {
    restoreFiles(run, snapshot);
    releaseValidationSession(run.id);
    for (const id of eligible) {
      const finding = listFindings(run.projectId).find((entry) => entry.id === id);
      if (finding?.status === 'FIXED') setFindingRepairState(run.projectId, id, 'REJECTED');
    }
    const detail = after
      ? `Re-validation showed no improvement (${before.gate} to ${after.gate}), so the repair was rolled back.`
      : `Re-validation could not finish, so the repair was rolled back. ${revalidation.failure ?? ''}`.trim();
    session.finalState = 'FAILED';
    session.stopReason = detail;
    saveSession(session);
    publishForRun(run, {
      type: 'verify.completed',
      status: 'failed',
      stage: 'testing',
      message: detail,
      data: { ok: false, durationMs: verifyMs, failed: failedRows(after), limitations: [] },
    });
    closeRepairTask(run, task, usages, detail);
    publishRepairCompleted(run, attemptTotal(), false);
    return { status: 'rolled-back', detail };
  }

  return acceptRepair(context, deps, {
    task,
    usages,
    session,
    eligible,
    snapshot,
    revalidation,
    after,
    verifyMs,
    attempts: attemptTotal(),
  });
}

function failedRows(summary: ValidationSummary | null): string[] {
  return (summary?.rows ?? []).filter((row) => row.status === 'FAIL').map((row) => row.name);
}

interface AcceptedRepair {
  task: AgentTask;
  usages: readonly (AgentUsage | null)[];
  session: RepairSessionState;
  eligible: ReadonlySet<string>;
  snapshot: FileSnapshot;
  revalidation: Revalidation;
  after: ValidationSummary;
  verifyMs: number;
  attempts: number;
}

/** Keeps a repair the re-validation proved, and publishes it if the gate passes. */
async function acceptRepair(
  context: PostRepairContext,
  deps: PostRepairDeps,
  accepted: AcceptedRepair,
): Promise<PostRepairOutcome> {
  const { run } = context;
  const { task, usages, eligible, snapshot, revalidation, after, verifyMs, attempts } = accepted;

  for (const entry of revalidation.agents) {
    entry.task.findings = entry.result.findings;
    entry.task.durationMs = entry.result.durationMs;
    entry.task.usage = entry.result.usage;
    entry.task.error = null;
    entry.task.completedAt = new Date().toISOString();
    context.commit(entry.task, entry.definition, entry.result);
  }
  rejectReturnedFindings(
    run,
    eligible,
    revalidation.agents.flatMap((e) => e.result.findings),
  );
  await context.resummarize();

  const passing = PASSING_GATES.includes(after.gate);
  publishForRun(run, {
    type: 'verify.completed',
    status: passing ? 'succeeded' : 'failed',
    stage: 'testing',
    message: `Re-validation after repair: ${after.gate}. ${after.gateReason}`,
    data: { ok: passing, durationMs: verifyMs, failed: failedRows(after), limitations: [] },
  });
  publishForRun(run, {
    type: 'files.changed',
    status: 'info',
    stage: 'repairing',
    message: 'Files changed by the verified repair.',
    data: changedPaths(runnableFiles(snapshot), runnableFiles(artifactsOf(run.id))),
  });

  // A failing project stays out of Preview: fewer failures is progress, and
  // the version a person opens should still be one that passed.
  const persist = passing
    ? await deps.persist(run, sumUsage(usages)).catch((error: unknown): PersistOutcome => ({
        persisted: false,
        reason: error instanceof Error ? error.message : String(error),
      }))
    : null;
  if (persist) {
    publishForRun(run, {
      type: 'note',
      status: 'info',
      stage: 'repairing',
      message: persist.persisted
        ? 'The repaired files are now the version Preview shows.'
        : `The repaired files did not reach Preview: ${persist.reason}`,
      data: persist.persisted ? { runId: persist.runId } : { error: persist.reason },
    });
  }

  const detail = `Re-validation after repair: ${after.gate}.`;
  closeRepairTask(run, task, usages, detail);
  publishRepairCompleted(run, attempts, passing);
  return { status: 'accepted', detail, gate: after.gate, persist };
}
