/**
 * The orchestrator's public surface: start, observe, cancel, resume.
 *
 * Runs execute detached from the request, the same shape the pipeline and
 * the run engine already use — `start` answers with the plan and the work
 * proceeds while the client polls. A 40-second DAG behind a 15-second HTTP
 * timeout would be a worse design for the same behaviour.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import { buildPlan } from './lib/planner.js';
import { listDefinitions, runnableAgents } from './lib/registry.js';
import { runPlan, refreshStatuses } from './lib/scheduler.js';
import { runnableFiles } from './lib/runnable-project.js';
import { artifactHistory, latestArtifact } from './lib/artifact-store.js';
import { latestTestRun } from './lib/validation-store.js';
import { runRepairSession } from './lib/repair-engine.js';
import { produceEdits } from './lib/repair-strategies.js';
import { realValidator } from './lib/repair-validator.js';
import { buildContext } from '../context-engine/context-engine.service.js';
import { audit } from '../../shared/security/audit.js';
import { getGraph } from '../engineering-graph/engineering-graph.service.js';
import { assembleIntelligence } from './lib/project-intelligence.js';
import type { GraphStatsInput, ProjectIntelligence } from './lib/project-intelligence.js';
import {
  activeSession as activeRepairSession,
  getRepair,
  latestSession as latestRepairSession,
  listRepairs,
} from './lib/repair-store.js';
import type { RepairConfig, RepairRecord, RepairSessionState } from '../../shared/types/repair.js';
import { getFinding, listFindings, setFindingStatus } from './lib/finding-store.js';
import type { FindingRecord } from './lib/finding-store.js';
import type { FindingStatus } from '../../shared/contracts/index.js';
import {
  abortRun,
  artifactsOf,
  createRun,
  eventsOf,
  getRunState,
  listRuns,
  progressOf,
  recordEvent,
  renewController,
  touch,
} from './lib/run-store.js';
import type { AgentId, ArtifactType } from '../../shared/contracts/index.js';
import type {
  AgentEvent,
  AgentRun,
  RunProgress,
  StartRunInput,
} from './agent-orchestrator.types.js';

export interface AgentRunView {
  run: AgentRun;
  progress: RunProgress;
}

function view(run: AgentRun): AgentRunView {
  return { run, progress: progressOf(run) };
}

/** Resolves the run for this owner, or 404s — never confirms someone else's id exists. */
function ownedRun(ownerId: string, runId: string): AgentRun {
  const state = getRunState(runId);
  if (state?.run.ownerId !== ownerId) {
    throw AppError.notFound('That agent run no longer exists — start a new one');
  }
  return state.run;
}

export async function startRun(ownerId: string, input: StartRunInput): Promise<AgentRunView> {
  await getProjectOrThrow(ownerId, input.projectId);

  const available = runnableAgents();
  if (available.length === 0) {
    throw AppError.badRequest('No agents are currently enabled');
  }

  const requested = input.agentIds?.length
    ? available.filter((definition) => input.agentIds?.includes(definition.id))
    : available;
  if (requested.length === 0) {
    throw AppError.badRequest('None of the requested agents are enabled');
  }

  const runId = randomUUID();
  const now = new Date().toISOString();
  const plan = buildPlan({
    projectId: input.projectId,
    runId,
    agentIds: requested.map((definition) => definition.id),
    priority: input.priority ?? 'NORMAL',
  });

  const run: AgentRun = {
    id: runId,
    projectId: input.projectId,
    ownerId,
    prompt: input.prompt.trim(),
    status: 'PENDING',
    tasks: plan.tasks,
    currentTaskId: null,
    createdAt: now,
    updatedAt: now,
    error: null,
    totals: { aiCalls: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, costUsd: 0 },
  };

  createRun(run, new AbortController());
  for (const task of run.tasks) {
    recordEvent(runId, 'AGENT_QUEUED', { taskId: task.id, agentId: task.agentId });
  }
  refreshStatuses(run);
  audit('AGENT_RUN_STARTED', {
    userId: ownerId,
    projectId: input.projectId,
    runId,
    detail: { agents: requested.length, promptChars: run.prompt.length },
  });

  logger.info('agent run planned', {
    runId,
    projectId: input.projectId,
    agents: requested.map((definition) => definition.id),
    waves: plan.waves.length,
  });

  void runPlan(run, run.prompt).catch((error: unknown) => {
    // The scheduler is written not to throw; if it ever does, the run must
    // still settle rather than hanging in RUNNING forever.
    logger.error('agent run crashed', { runId, error });
    run.status = 'FAILED';
    run.error = 'The orchestrator stopped unexpectedly';
    touch(run);
  });

  return view(run);
}

export function getRun(ownerId: string, runId: string): AgentRunView {
  return view(ownedRun(ownerId, runId));
}

/**
 * What a run produced, addressable by type.
 *
 * Deliberately a manifest of types and sizes rather than the content
 * itself: `backend-source` is hundreds of kilobytes, and a client polling
 * a run does not want it. `getArtifact` resolves one when it is actually
 * needed.
 */
export function listRunArtifacts(
  ownerId: string,
  runId: string,
): { type: string; sizeBytes: number }[] {
  const run = ownedRun(ownerId, runId);
  return Object.entries(artifactsOf(run.id)).map(([type, content]) => ({
    type,
    sizeBytes: Buffer.byteLength(JSON.stringify(content), 'utf8'),
  }));
}

export function getRunArtifact(ownerId: string, runId: string, type: string): unknown {
  const run = ownedRun(ownerId, runId);
  const artifacts: Partial<Record<ArtifactType, unknown>> = artifactsOf(run.id);
  const artifact = artifacts[type as ArtifactType];
  if (artifact === undefined) {
    throw AppError.notFound(`This run has no "${type}" artifact`);
  }
  return artifact;
}

/**
 * The generated project as a runnable file list — what Preview and Local
 * Run consume. Unchanged from the pipeline's shape, so neither had to
 * learn anything about agents.
 */
export function getRunProjectFiles(
  ownerId: string,
  runId: string,
): { path: string; content: string }[] {
  const run = ownedRun(ownerId, runId);
  const files = runnableFiles(artifactsOf(run.id));
  if (files.length === 0) {
    throw AppError.notFound('This run generated no project files');
  }
  return files;
}

/**
 * The finding store, read project-wide.
 *
 * Ownership is checked against the project rather than a run: findings
 * outlive the runs that observed them, and the whole point of the store
 * is to answer for the project across runs.
 */
export async function listProjectFindings(
  ownerId: string,
  projectId: string,
): Promise<FindingRecord[]> {
  await getProjectOrThrow(ownerId, projectId);
  return listFindings(projectId).sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

export async function getProjectFinding(
  ownerId: string,
  projectId: string,
  findingId: string,
): Promise<FindingRecord> {
  await getProjectOrThrow(ownerId, projectId);
  const finding = getFinding(projectId, findingId);
  if (!finding) throw AppError.notFound(`Finding "${findingId}" not found`);
  return finding;
}

const FINDING_STATUSES: readonly FindingStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'FALSE_POSITIVE',
];

/** A person's judgement about a finding — the only path that changes status. */
export async function updateFindingStatus(
  ownerId: string,
  projectId: string,
  findingId: string,
  status: string,
): Promise<FindingRecord> {
  await getProjectOrThrow(ownerId, projectId);
  if (!FINDING_STATUSES.includes(status as FindingStatus)) {
    throw AppError.badRequest(`status must be one of: ${FINDING_STATUSES.join(', ')}`);
  }
  const updated = setFindingStatus(projectId, findingId, status as FindingStatus);
  if (!updated) throw AppError.notFound(`Finding "${findingId}" not found`);
  return updated;
}

/**
 * The latest engineering review, or one version of it.
 *
 * Read from the versioned artifact store, so past reviews stay
 * addressable — Step 29's "do not silently overwrite" is the store's
 * versioning doing its job, not new machinery.
 */
export async function getEngineeringReview(
  ownerId: string,
  projectId: string,
  version?: number,
): Promise<{ current: unknown; versions: { version: number; createdAt: string }[] }> {
  await getProjectOrThrow(ownerId, projectId);
  const history = artifactHistory(projectId, 'engineering-review');
  if (history.length === 0) {
    throw AppError.notFound('No engineering review has been run for this project yet');
  }

  const record =
    version === undefined
      ? history.at(-1)
      : history.find(
          (entry) => (entry.content as { reviewVersion?: number }).reviewVersion === version,
        );
  if (!record) throw AppError.notFound(`No engineering review with version ${String(version)}`);

  return {
    current: record.content,
    versions: history.map((entry) => ({
      version: (entry.content as { reviewVersion?: number }).reviewVersion ?? entry.version,
      createdAt: entry.createdAt,
    })),
  };
}

/**
 * The latest validation: summary, reports and executed tests.
 *
 * Reads the versioned artifact store and the test-run store — snapshots of
 * what actually happened, never recomputed on read.
 */
export async function getValidation(
  ownerId: string,
  projectId: string,
): Promise<{
  summary: unknown;
  runtime: unknown;
  integration: unknown;
  tests: unknown;
  versions: { version: number; createdAt: string }[];
}> {
  await getProjectOrThrow(ownerId, projectId);
  const history = artifactHistory(projectId, 'validation-summary');
  if (history.length === 0) {
    throw AppError.notFound('No validation has been run for this project yet');
  }
  const latest = history.at(-1);
  return {
    summary: latest?.content ?? null,
    runtime: latestArtifactContent(projectId, 'runtime-report'),
    integration: latestArtifactContent(projectId, 'integration-report'),
    tests: latestTestRun(projectId),
    versions: history.map((entry) => ({ version: entry.version, createdAt: entry.createdAt })),
  };
}

function latestArtifactContent(projectId: string, type: ArtifactType): unknown {
  return latestArtifact(projectId, type)?.content ?? null;
}

/**
 * Starts an autonomous repair session for a project's open findings.
 *
 * Fire-and-poll like an agent run: the session record is returned
 * immediately and the loop advances server-side. One session per project
 * at a time — two concurrent surgeries on one patient share no anesthetic.
 */
export async function startRepairSession(
  ownerId: string,
  projectId: string,
  overrides: Partial<RepairConfig> = {},
): Promise<RepairSessionState> {
  await getProjectOrThrow(ownerId, projectId);
  if (activeRepairSession(projectId)) {
    throw AppError.conflict('A repair session is already running for this project');
  }
  if (listFindings(projectId).length === 0) {
    throw AppError.badRequest('This project has no findings to repair — run a validation first');
  }

  audit('REPAIR_STARTED', { userId: ownerId, projectId });
  const started = runRepairSession(projectId, overrides, {
    validator: realValidator,
    /*
     * The model fallback gets a compiled REPAIR context (Step 9): the
     * graph slice around the plan's targets, budgeted small. Deterministic
     * strategies never reach the model and never need it; when there is no
     * graph yet, the repair proceeds with the plan and files alone.
     */
    produce: async (finding, rca, plan) => {
      let contextText = '';
      try {
        const compiled = await buildContext(ownerId, {
          projectId,
          taskType: 'REPAIR',
          ...(rca.affectedNodes.length > 0 ? { targetNames: rca.affectedNodes } : {}),
        });
        contextText = compiled.text;
      } catch {
        // No graph is the first-run normal; the repair does not depend on it.
      }
      return produceEdits(finding, rca, plan, contextText);
    },
  }).catch((error: unknown) => {
    logger.warn('repair session rejected', { projectId, error });
    return null;
  });
  // Give the session a moment to register so the response carries it.
  await Promise.race([started, new Promise((resolve) => setTimeout(resolve, 150))]);
  const session = latestRepairSession(projectId);
  if (!session) throw AppError.internal('The repair session failed to start');
  return session;
}

export async function getRepairs(
  ownerId: string,
  projectId: string,
): Promise<{ session: RepairSessionState | null; repairs: RepairRecord[] }> {
  await getProjectOrThrow(ownerId, projectId);
  return { session: latestRepairSession(projectId), repairs: listRepairs(projectId) };
}

export async function getRepairDetail(
  ownerId: string,
  projectId: string,
  repairId: string,
): Promise<RepairRecord> {
  await getProjectOrThrow(ownerId, projectId);
  const record = getRepair(projectId, repairId);
  if (!record) throw AppError.notFound(`Repair "${repairId}" not found`);
  return record;
}

/**
 * The whole dashboard in one request (Step 22): health, agents, findings,
 * validation, repairs, tokens, graph statistics and run history, assembled
 * from stores that already hold the data. The graph is the only I/O; a
 * project with no graph yet gets nulls, not an error.
 */
export async function getProjectIntelligence(
  ownerId: string,
  projectId: string,
): Promise<ProjectIntelligence> {
  const startedAt = Date.now();
  await getProjectOrThrow(ownerId, projectId);

  let graph: GraphStatsInput | null = null;
  try {
    const view = await getGraph(ownerId, projectId);
    const names = (type: string, limit: number): string[] =>
      view.nodes
        .filter((node) => node.type === type)
        .slice(0, limit)
        .map((node) => node.name);
    graph = {
      nodeCount: view.stats.nodeCount,
      edgeCount: view.stats.edgeCount,
      nodesByType: view.stats.nodesByType,
      serviceNames: names('SERVICE', 6),
      entityNames: names('ENTITY', 6),
      dependencyNames: names('DEPENDENCY', 6),
    };
  } catch (error) {
    logger.debug('intelligence summary without graph', { projectId, error });
  }

  const summary = assembleIntelligence(projectId, ownerId, graph);

  // Observability (Step 30): a slow dashboard is a bug worth seeing.
  const durationMs = Date.now() - startedAt;
  if (durationMs > 500) {
    logger.warn('slow intelligence summary', { projectId, durationMs });
  }
  return summary;
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/**
 * Runs for one project the caller owns.
 *
 * Ownership is checked against the project in the path — a hardening fix:
 * the endpoint previously listed the caller's runs across all projects,
 * ignoring the `:projectId` scope entirely. It never leaked another user's
 * data (the run store is owner-keyed), but it answered 200 for a project
 * the caller did not own, which the 404 convention forbids.
 */
export async function listAgentRuns(ownerId: string, projectId: string): Promise<AgentRunView[]> {
  await getProjectOrThrow(ownerId, projectId);
  return listRuns(ownerId)
    .filter((run) => run.projectId === projectId)
    .map(view);
}

export function getEvents(ownerId: string, runId: string, after = 0): AgentEvent[] {
  ownedRun(ownerId, runId);
  return eventsOf(runId, after);
}

/**
 * Cancels a run.
 *
 * Pending work is cancelled immediately; a task already executing stops at
 * its next interruption point. Completed artifacts stay — cancellation is
 * a decision to stop, not to discard what already succeeded.
 */
export function cancelRun(ownerId: string, runId: string): AgentRunView {
  const run = ownedRun(ownerId, runId);
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return view(run);

  abortRun(runId);
  logger.info('agent run cancellation requested', { runId });
  return view(run);
}

/**
 * Resumes a failed or cancelled run.
 *
 * Completed tasks stay completed and are not re-run — their artifacts are
 * still in the store and re-deriving them would cost model calls to
 * produce the same output. Only what failed, blocked or was cancelled goes
 * back to PENDING.
 */
export async function resumeRun(ownerId: string, runId: string): Promise<AgentRunView> {
  const run = ownedRun(ownerId, runId);

  if (run.status === 'RUNNING') {
    throw AppError.badRequest('That run is still executing');
  }
  if (run.status === 'COMPLETED') {
    throw AppError.badRequest('That run already completed');
  }

  let resumable = 0;
  for (const task of run.tasks) {
    if (['FAILED', 'BLOCKED', 'CANCELLED'].includes(task.status)) {
      task.status = 'PENDING';
      task.error = null;
      task.failureKind = null;
      task.retryCount = 0;
      task.startedAt = null;
      task.completedAt = null;
      resumable += 1;
    }
  }
  if (resumable === 0) throw AppError.badRequest('That run has nothing left to resume');

  run.error = null;
  renewController(runId);
  refreshStatuses(run);
  touch(run);

  logger.info('agent run resumed', { runId, resumable });
  await Promise.resolve();
  void runPlan(run, run.prompt).catch((error: unknown) => {
    logger.error('agent run crashed on resume', { runId, error });
    run.status = 'FAILED';
    run.error = 'The orchestrator stopped unexpectedly';
    touch(run);
  });

  return view(run);
}

export interface AgentCatalogueEntry {
  id: AgentId;
  name: string;
  role: string;
  version: string;
  executionMode: string;
  /** Declared as available to plan with. */
  enabled: boolean;
  /** An implementation is registered. Enabled without this cannot run. */
  implemented: boolean;
  requires: string[];
  produces: string[];
  dependencies: string[];
}

/** The agent catalogue: every declaration, and whether it can actually run. */
export function listAgents(): AgentCatalogueEntry[] {
  const runnable = new Set(runnableAgents().map((definition) => definition.id));
  return listDefinitions().map((definition) => ({
    id: definition.id,
    name: definition.name,
    role: definition.role,
    version: definition.version,
    executionMode: definition.executionMode,
    enabled: definition.enabled,
    implemented: runnable.has(definition.id),
    requires: [...definition.requires],
    produces: [...definition.produces],
    dependencies: [...definition.dependencies],
  }));
}
