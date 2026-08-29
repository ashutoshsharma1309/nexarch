/**
 * Drives a run's DAG to completion.
 *
 * The loop is deliberately simple: find the tasks whose dependencies are
 * satisfied and whose input artifacts exist, run them, record what
 * happened, repeat. Everything interesting is in what it refuses to do.
 *
 * **It serializes every write.** Agents that produce or revise artifacts
 * run one at a time, because the artifact store and the graph sync are
 * read-modify-write with no transaction around them. The one exception is
 * earned, not assumed: a wave of agents that all declare `mutates: []` and
 * revise nothing — the review mesh — executes concurrently and then
 * commits serially, so the concurrent half only ever reads. This is the
 * "prove the isolation later, then turn it on" the original note promised.
 *
 * **It does not start a task whose inputs are missing.** Dependency
 * satisfaction is checked at the artifact level, not just the task level —
 * a completed upstream task that produced nothing usable still leaves its
 * dependents BLOCKED rather than letting them run on absent input.
 */
import { logger } from '../../../shared/logger/index.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { buildContext } from '../../context-engine/context-engine.service.js';
import { executeAgent } from './executor.js';
import { orderByPriority } from './planner.js';
import {
  artifactsOf,
  findTask,
  progressOf,
  recordEvent,
  signalOf,
  storeArtifacts,
  touch,
} from './run-store.js';
import { syncPartialGraph } from './graph-sync.js';
import { latestArtifact, writeArtifact } from './artifact-store.js';
import {
  agentCacheKey,
  isCacheableAgent,
  readAgentResult,
  writeAgentResult,
} from './agent-result-cache.js';
import { beginReview, findingsForReview, recordFinding } from './finding-store.js';
import { summarizeReview } from './review-summary.js';
import { summarizeValidation } from './validation-summary.js';
import { releaseValidationSession } from './validation-session.js';
import type {
  IntegrationResult,
  RuntimeResult,
  TestCase,
} from '../../../shared/types/validation.js';
import { buildManifest } from './generation-manifest.js';
import type { ManifestFile } from './generation-manifest.js';
import type {
  AgentContextPayload,
  AgentDefinition,
  AgentResult,
  ArtifactType,
} from '../../../shared/contracts/index.js';
import type { AgentRun, AgentTask } from '../agent-orchestrator.types.js';

/**
 * Whether a task can start.
 *
 * Three conditions, and each rules out a different way a run goes wrong:
 * every dependency finished, every dependency finished *successfully*, and
 * every declared input artifact actually exists.
 */
export function readiness(
  run: AgentRun,
  task: AgentTask,
  artifacts: Partial<Record<ArtifactType, unknown>>,
): 'READY' | 'PENDING' | 'BLOCKED' {
  const dependencies = task.dependencyTaskIds
    .map((id) => findTask(run, id))
    .filter((entry): entry is AgentTask => Boolean(entry));

  if (
    dependencies.some((dependency) =>
      ['FAILED', 'BLOCKED', 'CANCELLED'].includes(dependency.status),
    )
  ) {
    return 'BLOCKED';
  }
  if (dependencies.some((dependency) => dependency.status !== 'COMPLETED')) return 'PENDING';

  const missing = task.inputArtifactTypes.filter((type) => artifacts[type] === undefined);
  if (missing.length > 0) {
    // Missing inputs with no dependency left to supply them means nothing
    // will ever change — that is BLOCKED, not PENDING. Reporting it as
    // pending let a run whose only task could never start settle as
    // COMPLETED, which is the most misleading answer available.
    const pendingDependency = dependencies.some((dependency) =>
      ['PENDING', 'READY', 'RUNNING'].includes(dependency.status),
    );
    return pendingDependency ? 'PENDING' : 'BLOCKED';
  }
  return 'READY';
}

/** Recomputes every non-terminal task's status against current state. */
export function refreshStatuses(run: AgentRun): void {
  const artifacts = artifactsOf(run.id);
  for (const task of run.tasks) {
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'RUNNING'].includes(task.status)) continue;
    task.status = readiness(run, task, artifacts);
  }
}

/** Compiles context for an agent that declared it needs some. */
async function contextFor(run: AgentRun, task: AgentTask): Promise<AgentContextPayload | null> {
  const definition = getAgentDefinition(task.agentId);
  if (!definition?.requiredContext) return null;

  try {
    const compiled = await buildContext(run.ownerId, {
      projectId: run.projectId,
      runId: run.id,
      taskType: definition.requiredContext,
      includeDependents: true,
    });
    recordEvent(run.id, 'CONTEXT_RESOLVED', {
      taskId: task.id,
      agentId: task.agentId,
      detail: {
        tokens: compiled.tokens,
        selectedNodes: compiled.trace.selected.length,
        budget: compiled.budget.maxContextTokens,
        cache: compiled.trace.cache,
      },
    });
    return compiled;
  } catch (error) {
    // No graph yet is the normal case on a first run — the project is being
    // created by this very run. An agent proceeds without context rather
    // than failing, and the event log records that it did.
    recordEvent(run.id, 'CONTEXT_RESOLVED', {
      taskId: task.id,
      agentId: task.agentId,
      detail: { tokens: 0, unavailable: true, reason: 'no graph for this project yet' },
    });
    logger.debug('context unavailable for agent', { agentId: task.agentId, error });
    return null;
  }
}

/**
 * Runs the DAG until nothing is left that can run.
 *
 * Returns when every task is terminal or blocked. Never throws: a run that
 * fails reports failure through task state, because a rejected promise
 * here would lose the artifacts that did succeed.
 */
/** The three reviewers. Their findings land in the finding store. */
const REVIEW_AGENTS: ReadonlySet<string> = new Set([
  'security-engineer',
  'dependency-engineer',
  'code-quality-engineer',
]);

/** The validators. Their findings join the same store, same identity rules. */
const VALIDATION_AGENTS: ReadonlySet<string> = new Set([
  'runtime-engineer',
  'integration-engineer',
  'test-engineer',
]);

/**
 * Which review a run's findings belong to. Opened when a run that includes
 * reviewers starts, so all three record against the same version and a
 * later run against the same project gets the next one.
 */
const reviewVersions = new Map<string, number>();

export async function runPlan(run: AgentRun, prompt: string): Promise<void> {
  const signal = signalOf(run.id);
  run.status = 'RUNNING';
  touch(run);

  if (
    run.tasks.some((task) => REVIEW_AGENTS.has(task.agentId) || VALIDATION_AGENTS.has(task.agentId))
  ) {
    reviewVersions.set(run.id, beginReview(run.projectId));
  }

  // What the project held before this run touched anything. Captured here
  // rather than read back at the end because by then this run's own writes
  // are the latest version, and diffing a run against itself would report
  // every file as unchanged.
  const before = {
    backend: sourceFilesOf(latestArtifact(run.projectId, 'backend-source')?.content),
    frontend: sourceFilesOf(latestArtifact(run.projectId, 'frontend-source')?.content),
  };

  for (;;) {
    if (signal.aborted) {
      for (const task of run.tasks) {
        if (['PENDING', 'READY', 'BLOCKED'].includes(task.status)) task.status = 'CANCELLED';
      }
      run.status = 'CANCELLED';
      run.currentTaskId = null;
      touch(run);
      recordEvent(run.id, 'AGENT_CANCELLED', { detail: { ...progressOf(run) } });
      releaseValidationSession(run.id);
      return;
    }

    refreshStatuses(run);
    const ready = orderByPriority(run.tasks.filter((task) => task.status === 'READY'));
    if (ready.length === 0) break;

    // A wave of agents that all declare they mutate nothing can execute
    // together. Anything else still goes one at a time.
    const readOnly = ready.filter(isReadOnly);
    if (readOnly.length > 1) {
      await runReadOnlyWave(run, readOnly, prompt);
      continue;
    }

    const task = ready[0];
    if (!task) break;

    await runTask(run, task, prompt);
  }

  refreshStatuses(run);
  const progress = progressOf(run);
  run.currentTaskId = null;

  // A task still pending when nothing is left to run is stalled: its inputs
  // never arrived and never will. Counting it as success would report a run
  // that did nothing as a run that finished.
  const stalled = progress.pending > 0;
  run.status = progress.failed > 0 || progress.blocked > 0 || stalled ? 'FAILED' : 'COMPLETED';

  if (run.status === 'FAILED') {
    const firstFailure = run.tasks.find((task) => task.status === 'FAILED');
    const firstBlocked = run.tasks.find((task) =>
      ['BLOCKED', 'PENDING', 'READY'].includes(task.status),
    );
    if (firstFailure) {
      run.error = `${getAgentDefinition(firstFailure.agentId)?.name ?? firstFailure.agentId} failed: ${firstFailure.error ?? 'unknown'}`;
    } else if (firstBlocked) {
      const name = getAgentDefinition(firstBlocked.agentId)?.name ?? firstBlocked.agentId;
      const missing = firstBlocked.inputArtifactTypes.join(', ');
      run.error = `${name} could not run — it needs ${missing || 'inputs'} that no agent in this run produces`;
    } else {
      run.error = 'One or more agents could not run';
    }
  }
  recordGenerationManifest(run, before);
  await recordEngineeringReview(run);
  await recordValidationSummary(run);
  reviewVersions.delete(run.id);
  // Step 13: validation processes never outlive the validation.
  releaseValidationSession(run.id);

  touch(run);
  logger.info('agent run settled', { runId: run.id, status: run.status, ...progress });
}

/**
 * Moves a reviewer's findings into the finding store, where identity and
 * deduplication live.
 *
 * The task keeps its own copy — that is the per-run record — but the store
 * is what answers "is this still open", across agents and across reviews.
 */
function recordReviewFindings(run: AgentRun, task: AgentTask, result: AgentResult): void {
  const version = reviewVersions.get(run.id);
  if (version === undefined) return;
  if (!REVIEW_AGENTS.has(task.agentId) && !VALIDATION_AGENTS.has(task.agentId)) return;

  let fresh = 0;
  for (const finding of result.findings) {
    const { isNew } = recordFinding({
      projectId: run.projectId,
      runId: run.id,
      agentId: task.agentId,
      reviewVersion: version,
      finding,
    });
    if (isNew) fresh += 1;
  }

  recordEvent(run.id, 'FINDINGS_RECORDED', {
    taskId: task.id,
    agentId: task.agentId,
    detail: { recorded: result.findings.length, new: fresh, reviewVersion: version },
  });
}

/**
 * Writes the ENGINEERING_REVIEW artifact once every reviewer has settled.
 *
 * Written even when a reviewer failed — a review of two perspectives is
 * still a review, and the summary's PARTIAL_REVIEW status says exactly
 * what is missing. Skipped entirely when the run had no reviewers.
 *
 * Ends with one more graph sync, because this artifact is what carries
 * findings into the graph as FINDING nodes and the syncs before it ran
 * without them.
 */
async function recordEngineeringReview(run: AgentRun): Promise<void> {
  const version = reviewVersions.get(run.id);
  if (version === undefined) return;

  const reviewTasks = run.tasks.filter((task) => REVIEW_AGENTS.has(task.agentId));
  if (reviewTasks.length === 0) return;

  const agents = reviewTasks.map((task) => ({
    agentId: task.agentId,
    status: task.status === 'COMPLETED' ? ('COMPLETED' as const) : ('FAILED' as const),
    findings: task.findings.length,
    error:
      task.error ??
      (task.status === 'COMPLETED' ? null : `task ended ${task.status.toLowerCase()}`),
  }));

  const findings = findingsForReview(run.projectId, version);
  const generatedAt = new Date().toISOString();
  const summary = summarizeReview({
    reviewVersion: version,
    findings,
    agents,
    notes: [],
    generatedAt,
  });

  const review = {
    reviewVersion: version,
    projectId: run.projectId,
    runId: run.id,
    generatedAt,
    summary,
    findings,
    usage: reviewTasks.map((task) => ({
      agentId: task.agentId,
      durationMs: task.durationMs,
      usage: task.usage,
    })),
  };

  storeArtifacts(run.id, { 'engineering-review': review });
  writeArtifact({
    projectId: run.projectId,
    runId: run.id,
    type: 'engineering-review',
    // Assembled by the run from all three reviewers' findings; attributed
    // to the security engineer as first among equals, not as sole author.
    agentId: 'security-engineer',
    agentVersion: getAgentDefinition('security-engineer')?.version ?? '0',
    derivedFrom: [],
    content: review,
  });

  recordEvent(run.id, 'ARTIFACT_CREATED', {
    detail: {
      type: 'engineering-review',
      version,
      findings: findings.length,
      status: summary.status,
      score: summary.score.score,
    },
  });

  const synced = await syncPartialGraph(run, artifactsOf(run.id));
  if (synced) {
    recordEvent(run.id, 'GRAPH_UPDATED', { detail: { ...synced, findings: findings.length } });
  }

  logger.info('engineering review recorded', {
    runId: run.id,
    reviewVersion: version,
    status: summary.status,
    findings: findings.length,
    score: summary.score.score,
  });
}

/**
 * Writes the run's validation summary, when validation agents ran.
 *
 * Assembled from the reports the agents actually produced — a summary of
 * facts, gated by the transparent rules in `validation-summary.ts`. Written
 * even when a validator failed, because "the runtime engineer itself died"
 * is a validation outcome someone needs to see, not a reason to have no
 * summary at all.
 */
async function recordValidationSummary(run: AgentRun): Promise<void> {
  const validationTasks = run.tasks.filter((task) => VALIDATION_AGENTS.has(task.agentId));
  if (validationTasks.length === 0) return;

  const artifacts = artifactsOf(run.id);
  const runtime = (artifacts['runtime-report'] ?? null) as RuntimeResult | null;
  const integration = (artifacts['integration-report'] ?? null) as IntegrationResult | null;
  const testReport = artifacts['test-report'] as { cases?: TestCase[] } | undefined;

  const summary = summarizeValidation({
    projectId: run.projectId,
    runId: run.id,
    runtime,
    integration,
    cases: testReport?.cases ?? [],
    agents: validationTasks.map((task) => ({
      agentId: task.agentId,
      status: task.status === 'COMPLETED' ? ('COMPLETED' as const) : ('FAILED' as const),
      durationMs: task.durationMs,
    })),
  });

  storeArtifacts(run.id, { 'validation-summary': summary });
  writeArtifact({
    projectId: run.projectId,
    runId: run.id,
    type: 'validation-summary',
    agentId: 'test-engineer',
    agentVersion: getAgentDefinition('test-engineer')?.version ?? '0',
    derivedFrom: [],
    content: summary,
  });

  recordEvent(run.id, 'ARTIFACT_CREATED', {
    detail: { type: 'validation-summary', gate: summary.gate, tests: summary.tests.total },
  });

  const synced = await syncPartialGraph(run, artifactsOf(run.id));
  if (synced) {
    recordEvent(run.id, 'GRAPH_UPDATED', { detail: { ...synced } });
  }

  logger.info('validation summary recorded', {
    runId: run.id,
    gate: summary.gate,
    reason: summary.gateReason,
  });
}

/** The `files` array inside a `*-source` artifact, if the artifact exists. */
function sourceFilesOf(content: unknown): ManifestFile[] {
  const value = content as { files?: ManifestFile[] } | undefined;
  return value?.files ?? [];
}

/**
 * Writes the run's generation manifest, when the run generated anything.
 *
 * The manifest belongs to the run rather than to any one agent: it is the
 * answer to "what did this run do to my project", and no single agent can
 * answer that. It is written even for a failed run, because a run that
 * generated a backend and then failed at the frontend still changed files,
 * and a manifest that appears only on success would hide exactly the case
 * where someone most needs to know what happened.
 */
function recordGenerationManifest(
  run: AgentRun,
  before: { backend: ManifestFile[]; frontend: ManifestFile[] },
): void {
  const artifacts = artifactsOf(run.id);
  const backendFiles = sourceFilesOf(artifacts['backend-source']);
  const frontendFiles = sourceFilesOf(artifacts['frontend-source']);
  if (backendFiles.length === 0 && frontendFiles.length === 0) return;

  const manifest = buildManifest(
    run.projectId,
    run.id,
    [
      { agentId: 'backend-engineer', files: backendFiles, previous: before.backend },
      { agentId: 'frontend-engineer', files: frontendFiles, previous: before.frontend },
    ],
    new Date().toISOString(),
  );

  storeArtifacts(run.id, { 'generation-manifest': manifest });
  writeArtifact({
    projectId: run.projectId,
    runId: run.id,
    type: 'generation-manifest',
    // The run assembled it from every generator's output; attributing it to
    // one of them would be a claim about authorship that is not true.
    agentId: 'frontend-engineer',
    agentVersion: getAgentDefinition('frontend-engineer')?.version ?? '0',
    derivedFrom: [],
    content: manifest,
  });

  recordEvent(run.id, 'ARTIFACT_CREATED', {
    detail: { type: 'generation-manifest', ...manifest.totals },
  });
  logger.info('generation manifest', { runId: run.id, ...manifest.totals });
}

/**
 * Whether an agent is safe to run alongside its peers.
 *
 * The test is its own declaration: an agent that mutates no graph node
 * types and revises no artifact reads the project and writes only its own
 * outputs. That is checked here rather than by listing agent ids, so a
 * future agent becomes concurrent — or stops being — by changing what it
 * declares, not by someone remembering to edit the scheduler.
 */
function isReadOnly(task: AgentTask): boolean {
  const definition = getAgentDefinition(task.agentId);
  if (!definition) return false;
  return definition.mutates.length === 0 && (definition.revises ?? []).length === 0;
}

/**
 * Executes a wave of read-only agents concurrently, then commits them one
 * at a time.
 *
 * This is the narrow exception the note at the top of this file described
 * as "prove the isolation later, then turn it on". The isolation is the
 * split between `executeTask` and `commitTask`: the concurrent half only
 * reads shared state, and everything that writes it — the artifact store,
 * its version counters, the graph — stays strictly sequential.
 *
 * A failure in one agent settles that agent's task and nothing else, which
 * is what lets a run report two reviews complete and one failed rather
 * than losing all three.
 */
async function runReadOnlyWave(
  run: AgentRun,
  tasks: readonly AgentTask[],
  prompt: string,
): Promise<void> {
  logger.info('running read-only agents concurrently', {
    runId: run.id,
    agents: tasks.map((task) => task.agentId),
  });

  const executed = await Promise.all(tasks.map((task) => executeTask(run, task, prompt)));

  for (const [index, outcome] of executed.entries()) {
    const task = tasks[index];
    if (!task || !outcome) continue;
    commitTask(run, task, outcome.definition, outcome.result);
  }

  // One sync after the whole wave rather than one per agent: the graph is
  // rebuilt from the full artifact set either way, so syncing three times
  // would do the same work twice for nothing.
  const last = tasks.find((task) => task.status === 'COMPLETED');
  if (last) await syncAfter(run, last);
}

/**
 * Runs one agent to completion: execute, then commit.
 *
 * The two halves are separate functions because a wave of read-only agents
 * executes concurrently and commits one at a time. See `runReadOnlyWave`.
 */
async function runTask(run: AgentRun, task: AgentTask, prompt: string): Promise<void> {
  const executed = await executeTask(run, task, prompt);
  if (executed) commitTask(run, task, executed.definition, executed.result);
  if (executed) await syncAfter(run, task);
}

/**
 * The concurrent-safe half: resolve context and run the agent.
 *
 * Touches only this task's own fields and the run's token totals. It reads
 * the artifact map but never writes it, which is what makes two of these
 * safe to have in flight at once.
 */
async function executeTask(
  run: AgentRun,
  task: AgentTask,
  prompt: string,
): Promise<{ definition: AgentDefinition; result: AgentResult } | null> {
  const definition = getAgentDefinition(task.agentId);
  if (!definition) {
    task.status = 'FAILED';
    task.error = `Agent "${task.agentId}" is not declared`;
    task.failureKind = 'internal';
    return null;
  }

  task.status = 'RUNNING';
  task.startedAt = new Date().toISOString();
  run.currentTaskId = task.id;
  touch(run);
  recordEvent(run.id, 'AGENT_STARTED', { taskId: task.id, agentId: task.agentId });

  /*
   * Agent-result cache (Steps 3, 21). A cacheable agent whose content
   * address is already known was already run on identical inputs — reuse
   * its result rather than re-resolving context and re-calling the model.
   * The key is computed from the artifacts as they stand right now, so an
   * upstream change this run already invalidated the hit before we look.
   */
  const currentArtifacts = artifactsOf(run.id);
  let cacheKey: string | null = null;
  if (isCacheableAgent(task.agentId)) {
    // The cache is never a single point of failure (Step 40): if keying or
    // reading it throws, the agent simply executes as if the cache were
    // absent. A cache is an optimization, not a dependency.
    let cached: AgentResult | null = null;
    try {
      cacheKey = agentCacheKey({
        projectId: run.projectId,
        definition,
        prompt,
        inputArtifacts: currentArtifacts,
      });
      cached = readAgentResult(cacheKey);
    } catch (error) {
      logger.warn('agent-result cache unavailable; executing normally', {
        agentId: task.agentId,
        error,
      });
      cacheKey = null;
      cached = null;
    }
    if (cached) {
      task.retryCount = 0;
      task.completedAt = new Date().toISOString();
      task.durationMs = 0;
      task.findings = cached.findings;
      task.usage = cached.usage;
      task.cached = true;
      run.totals.cache ??= { hits: 0, misses: 0, tokensSaved: 0, aiCallsSaved: 0 };
      run.totals.cache.hits += 1;
      if (cached.usage) {
        run.totals.cache.tokensSaved += cached.usage.inputTokens + cached.usage.outputTokens;
        run.totals.cache.aiCallsSaved += 1;
      }
      recordEvent(run.id, 'AGENT_COMPLETED', {
        taskId: task.id,
        agentId: task.agentId,
        detail: { cached: true },
      });
      return { definition, result: cached };
    }
    run.totals.cache ??= { hits: 0, misses: 0, tokensSaved: 0, aiCallsSaved: 0 };
    run.totals.cache.misses += 1;
  }

  const context = await contextFor(run, task);

  if (definition.executionMode === 'ai') {
    recordEvent(run.id, 'AI_REQUEST_STARTED', { taskId: task.id, agentId: task.agentId });
  }

  const { result, attempts } = await executeAgent(definition, {
    projectId: run.projectId,
    runId: run.id,
    taskId: task.id,
    prompt,
    inputArtifacts: currentArtifacts,
    context,
    signal: signalOf(run.id),
  });

  task.retryCount = Math.max(0, attempts - 1);
  task.completedAt = new Date().toISOString();
  task.durationMs = result.durationMs;
  task.findings = result.findings;
  task.usage = result.usage;

  if (result.usage) {
    recordEvent(run.id, 'AI_REQUEST_COMPLETED', {
      taskId: task.id,
      agentId: task.agentId,
      detail: {
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
    });
    run.totals.aiCalls += 1;
    run.totals.inputTokens += result.usage.inputTokens;
    run.totals.outputTokens += result.usage.outputTokens;
    run.totals.contextTokens += result.usage.contextTokens;
    run.totals.costUsd = Number((run.totals.costUsd + result.usage.costUsd).toFixed(6));
  }

  if (result.status !== 'succeeded') {
    task.status = result.failureKind === 'cancelled' ? 'CANCELLED' : 'FAILED';
    task.error = result.error;
    task.failureKind = result.failureKind;
    recordEvent(run.id, 'AGENT_FAILED', {
      taskId: task.id,
      agentId: task.agentId,
      detail: { kind: result.failureKind, retries: task.retryCount },
    });
    touch(run);
    return null;
  }

  // Cache the successful result under the key computed before execution.
  if (cacheKey) {
    try {
      writeAgentResult(run.projectId, cacheKey, result);
    } catch (error) {
      logger.debug('agent-result cache write failed; result still returned', { error });
    }
  }

  return { definition, result };
}

/**
 * The serial half: write artifacts and mark the task done.
 *
 * Never runs concurrently with another commit, because the artifact store
 * and the version counters behind it are read-modify-write.
 */
function commitTask(
  run: AgentRun,
  task: AgentTask,
  definition: AgentDefinition,
  result: AgentResult,
): void {
  recordEvent(run.id, 'VALIDATION_PASSED', { taskId: task.id, agentId: task.agentId });

  // Provenance: whatever this agent declared it consumes, at the version
  // that existed when it ran. Recorded before the write so a new artifact
  // never lists itself among its own inputs.
  const derivedFrom = definition.requires
    .map((type) => latestArtifact(run.projectId, type)?.id)
    .filter((id): id is string => Boolean(id));

  storeArtifacts(run.id, result.artifacts);
  for (const [type, content] of Object.entries(result.artifacts)) {
    const record = writeArtifact({
      projectId: run.projectId,
      runId: run.id,
      type: type as ArtifactType,
      agentId: task.agentId,
      agentVersion: definition.version,
      derivedFrom,
      content,
    });
    task.artifactIds.push(record.id);
    recordEvent(run.id, 'ARTIFACT_CREATED', {
      taskId: task.id,
      agentId: task.agentId,
      // Version is the point: a regenerated architecture is v2, not a
      // silent overwrite of v1.
      detail: { type, version: record.version, derivedFrom: derivedFrom.length },
    });
  }

  recordReviewFindings(run, task, result);

  task.status = 'COMPLETED';
  task.summary = summarize(result.artifacts);
  task.error = null;
  recordEvent(run.id, 'AGENT_COMPLETED', {
    taskId: task.id,
    agentId: task.agentId,
    detail: { durationMs: task.durationMs, findings: task.findings.length },
  });
  touch(run);
}

/**
 * Re-syncs the graph after a task's artifacts land.
 *
 * Separate from `commitTask` and always awaited alone: the sync is a
 * database read-modify-write, so two of them overlapping would race. The
 * graph is updated as artifacts appear rather than once at the end, which
 * is what lets a later agent's context request see what an earlier agent
 * produced.
 */
async function syncAfter(run: AgentRun, task: AgentTask): Promise<void> {
  if (task.status !== 'COMPLETED') return;
  const synced = await syncPartialGraph(run, artifactsOf(run.id));
  if (synced) {
    recordEvent(run.id, 'GRAPH_UPDATED', {
      taskId: task.id,
      agentId: task.agentId,
      detail: { ...synced },
    });
  }
}

/** One line of what a task produced, from the artifacts themselves. */
function summarize(artifacts: Partial<Record<ArtifactType, unknown>>): string {
  const parts: string[] = [];

  const spec = artifacts['requirement-spec'] as
    { projectType?: string; modules?: unknown[]; database?: unknown[] } | undefined;
  if (spec) {
    parts.push(
      `${spec.projectType ?? 'project'} · ${String(spec.modules?.length ?? 0)} modules · ${String(spec.database?.length ?? 0)} entities`,
    );
  }

  const plan = artifacts['architecture-plan'] as
    { apiModules?: unknown[]; frontend?: { pages?: unknown[] } } | undefined;
  if (plan) {
    parts.push(
      `${String(plan.apiModules?.length ?? 0)} API modules · ${String(plan.frontend?.pages?.length ?? 0)} pages`,
    );
  }

  const product = artifacts['product-spec'] as
    { modules?: unknown[]; journeys?: unknown[]; screens?: unknown[] } | undefined;
  if (product) {
    parts.push(
      `${String(product.modules?.length ?? 0)} modules · ${String(product.journeys?.length ?? 0)} journeys · ${String(product.screens?.length ?? 0)} screens`,
    );
  }

  const design = artifacts['database-design'] as { tables?: { columns: unknown[] }[] } | undefined;
  if (design?.tables) {
    const columns = design.tables.reduce((total, table) => total + table.columns.length, 0);
    parts.push(`${String(design.tables.length)} tables · ${String(columns)} columns`);
  }

  const api = artifacts['api-contract'] as { paths?: Record<string, unknown> } | undefined;
  if (api?.paths) {
    parts.push(`${String(Object.keys(api.paths).length)} endpoints`);
  }

  const backend = artifacts['backend-metadata'] as
    { stats?: { files?: number; modules?: number; endpoints?: number } } | undefined;
  if (backend?.stats) {
    parts.push(
      `${String(backend.stats.files ?? 0)} files · ${String(backend.stats.modules ?? 0)} modules · ${String(backend.stats.endpoints ?? 0)} routes`,
    );
  }

  const frontend = artifacts['frontend-metadata'] as
    { stats?: { files?: number; pages?: number; components?: number } } | undefined;
  if (frontend?.stats) {
    parts.push(
      `${String(frontend.stats.files ?? 0)} files · ${String(frontend.stats.pages ?? 0)} pages · ${String(frontend.stats.components ?? 0)} components`,
    );
  }

  const security = artifacts['security-report'] as
    | {
        report?: { findings?: unknown[] };
        sourceScan?: { filesScanned?: number; findings?: number };
      }
    | undefined;
  if (security?.sourceScan) {
    const design = security.report?.findings?.length ?? 0;
    parts.push(
      `${String(design)} design findings · ${String(security.sourceScan.findings ?? 0)} source findings · ${String(security.sourceScan.filesScanned ?? 0)} files scanned`,
    );
  }

  const dependency = artifacts['dependency-report'] as
    { findings?: unknown[]; areas?: { dependencies: number }[] } | undefined;
  if (dependency?.areas) {
    const declared = dependency.areas.reduce((sum, area) => sum + area.dependencies, 0);
    parts.push(
      `${String(dependency.findings?.length ?? 0)} findings across ${String(declared)} declared dependencies`,
    );
  }

  const quality = artifacts['quality-report'] as
    { findings?: unknown[]; stats?: { backendFiles?: number; frontendFiles?: number } } | undefined;
  if (quality?.stats) {
    const files = (quality.stats.backendFiles ?? 0) + (quality.stats.frontendFiles ?? 0);
    parts.push(`${String(quality.findings?.length ?? 0)} findings across ${String(files)} files`);
  }

  const runtimeReport = artifacts['runtime-report'] as
    | {
        startupStatus?: string;
        buildStatus?: string;
        typeCheckStatus?: string;
        processes?: unknown[];
      }
    | undefined;
  if (runtimeReport) {
    parts.push(
      `build ${runtimeReport.buildStatus ?? '—'} · typecheck ${runtimeReport.typeCheckStatus ?? '—'} · startup ${runtimeReport.startupStatus ?? '—'}`,
    );
  }

  const integrationReport = artifacts['integration-report'] as
    { checks?: { status: string }[]; endpoints?: unknown[] } | undefined;
  if (integrationReport?.checks) {
    const passed = integrationReport.checks.filter((check) => check.status === 'PASS').length;
    parts.push(
      `${String(passed)}/${String(integrationReport.checks.length)} checks passed · ${String(integrationReport.endpoints?.length ?? 0)} endpoints probed`,
    );
  }

  const testReport = artifacts['test-report'] as { cases?: { status: string }[] } | undefined;
  if (testReport?.cases) {
    const passed = testReport.cases.filter((entry) => entry.status === 'PASSED').length;
    const failed = testReport.cases.filter((entry) => entry.status === 'FAILED').length;
    const blocked = testReport.cases.filter((entry) => entry.status === 'BLOCKED').length;
    parts.push(
      `${String(passed)}/${String(testReport.cases.length)} tests passed · ${String(failed)} failed · ${String(blocked)} blocked`,
    );
  }

  const review = artifacts['ux-review'] as
    { findings?: unknown[]; passed?: unknown[]; reviewedScreens?: number } | undefined;
  const improvements = artifacts['ux-improvements'] as { improvements?: unknown[] } | undefined;
  if (review) {
    parts.push(
      `${String(review.findings?.length ?? 0)} UX findings · ${String(review.passed?.length ?? 0)} checks clean · ${String(improvements?.improvements?.length ?? 0)} fixes applied`,
    );
  }

  return parts.at(-1) ?? 'completed';
}
