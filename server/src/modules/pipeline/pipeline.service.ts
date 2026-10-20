/**
 * The end-to-end run: one prompt in, a runnable project out.
 *
 *   analysis → architecture → database → backend → frontend → security
 *            → dependencies
 *
 * Each stage consumes only the previous stage's structured output, and the
 * run object records what each one actually did — status, duration, a
 * one-line summary — so the client renders real state rather than a
 * progress bar counting to a number nobody measured.
 *
 * Runs execute detached from the request: `start()` returns the run in
 * `running` with every stage `pending`, and the client polls. That keeps a
 * 30-second generation off a 15-second HTTP timeout, and it is the same
 * shape the run engine already uses for sessions.
 *
 * Every run belongs to a project. A caller may name one; a caller that does
 * not gets a project derived from the prompt, created on the spot. That
 * keeps the one-prompt flow exactly as it was — type a description, press
 * generate — while making User → Project → Run real underneath it. Stage
 * state stays in memory (see `lib/run-store.ts` for why); the durable half
 * is a `generations` row.
 */
import { randomUUID } from 'node:crypto';
import { closeRun, openRun } from './lib/run-store.js';
import { loadRunArtifacts, saveRunArtifacts } from './lib/run-artifact-store.js';

import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { synchronize as synchronizeGraph } from '../engineering-graph/index.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import {
  analyzeWithAi,
  deriveProjectName,
  designEntityFields,
  writeSiteDesign,
} from './lib/ai-stages.js';
import { auditDomainRelevance, summarizeRelevance } from './lib/domain-relevance.js';
import { describeAll, isArtifactType, selectArtifact } from './lib/artifact-index.js';
import type { AiCallStat } from './lib/ai-stages.js';
import type { AgentId } from '../../shared/contracts/agent.js';
import type { ArtifactDescriptor } from '../../shared/contracts/artifact.js';
import type {
  PipelineArtifacts,
  PipelineRun,
  PipelineStage,
  RunPhase,
  StageId,
  StartRunInput,
} from './pipeline.types.js';

/**
 * The stages, in order, each naming the agent that will eventually own it.
 * `agentId` carries no behaviour today — it is the migration seam: a later
 * phase replaces one stage's function call with that agent and leaves the
 * rest of this list alone. See `shared/contracts/agent-registry.ts`.
 */
const STAGE_TEMPLATE: readonly {
  id: StageId;
  label: string;
  engine: 'ai' | 'deterministic';
  agentId: AgentId;
}[] = [
  { id: 'analysis', label: 'Requirement Analysis', engine: 'ai', agentId: 'requirement-analyst' },
  {
    id: 'architecture',
    label: 'Architecture Planning',
    engine: 'ai',
    agentId: 'architecture-agent',
  },
  {
    id: 'database',
    label: 'Database Design',
    engine: 'deterministic',
    agentId: 'database-architect',
  },
  {
    id: 'backend',
    label: 'Backend Generation',
    engine: 'deterministic',
    agentId: 'backend-engineer',
  },
  {
    id: 'frontend',
    label: 'Frontend Generation',
    engine: 'deterministic',
    agentId: 'frontend-engineer',
  },
  {
    id: 'security',
    label: 'Security Hardening',
    engine: 'deterministic',
    agentId: 'security-engineer',
  },
  {
    id: 'dependencies',
    label: 'Dependency Graph',
    engine: 'deterministic',
    agentId: 'dependency-analyst',
  },
  {
    id: 'graph',
    label: 'Engineering Graph',
    engine: 'deterministic',
    agentId: 'dependency-analyst',
  },
];

/** Runs are process-local, like every other generator cache in this platform. */
const MAX_RUNS = 20;
const runs = new Map<
  string,
  { run: PipelineRun; artifacts: PipelineArtifacts | null; ownerId: string | null }
>();

/**
 * Resolves a run the caller is allowed to see (Phase 16).
 *
 * A run belongs to the user who started it. "Not yours" is reported as
 * not-found — identical to a run that never existed — so a run id cannot be
 * probed for existence across users. `ownerId` is null only for runs a test
 * starts outside the API; a real request always carries an owner.
 */
function ownedEntry(
  id: string,
  ownerId: string | null,
): { run: PipelineRun; artifacts: PipelineArtifacts | null; ownerId: string | null } {
  const entry = runs.get(id);
  if (!entry) throw AppError.notFound('That generation run no longer exists — start a new one');
  if (entry.ownerId !== ownerId) {
    throw AppError.notFound('That generation run no longer exists — start a new one');
  }
  return entry;
}

/**
 * Lifecycle observers.
 *
 * Generating a project and recording that it happened are different jobs
 * with different failure modes: a database that is briefly unreachable must
 * not cost a user their generated application. So the engine announces what
 * it did and does not care who is listening — `lib/run-recorder.ts`
 * subscribes at module wiring time to write the durable row.
 *
 * It also keeps the engine's tests honest: they import this service
 * directly, register nothing, and therefore need no database to exercise
 * the whole pipeline.
 */
export type RunObserver = (run: PipelineRun, phase: RunPhase) => void;

const observers: RunObserver[] = [];

export function observeRuns(observer: RunObserver): void {
  observers.push(observer);
}

function emit(run: PipelineRun, phase: RunPhase): void {
  for (const observer of observers) {
    try {
      observer(run, phase);
    } catch (error) {
      logger.warn('run observer threw', { runId: run.id, phase, error });
    }
  }
}

function newStages(): PipelineStage[] {
  return STAGE_TEMPLATE.map((stage) => ({
    ...stage,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: null,
    error: null,
    degraded: false,
  }));
}

function touch(run: PipelineRun): void {
  run.updatedAt = new Date().toISOString();
}

function stageOf(run: PipelineRun, id: StageId): PipelineStage {
  const stage = run.stages.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`unknown stage "${id}"`);
  return stage;
}

function beginStage(run: PipelineRun, id: StageId): PipelineStage {
  const stage = stageOf(run, id);
  stage.status = 'running';
  stage.startedAt = new Date().toISOString();
  touch(run);
  return stage;
}

function completeStage(
  run: PipelineRun,
  id: StageId,
  summary: string,
  options: { degraded?: boolean; note?: string | null } = {},
): void {
  const stage = stageOf(run, id);
  stage.status = 'completed';
  stage.completedAt = new Date().toISOString();
  stage.durationMs = stage.startedAt
    ? Date.parse(stage.completedAt) - Date.parse(stage.startedAt)
    : null;
  stage.summary = options.note ? `${summary} — ${options.note}` : summary;
  stage.degraded = options.degraded ?? false;
  touch(run);
}

function skipStage(run: PipelineRun, id: StageId, reason: string): void {
  const stage = stageOf(run, id);
  stage.status = 'skipped';
  stage.completedAt = new Date().toISOString();
  stage.summary = reason;
  touch(run);
}

function failRun(run: PipelineRun, id: StageId, error: unknown): void {
  const stage = stageOf(run, id);
  const message = userFacingError(error);
  stage.status = 'failed';
  stage.completedAt = new Date().toISOString();
  stage.error = message;
  for (const other of run.stages) {
    if (other.status === 'pending') other.status = 'skipped';
  }
  run.status = 'failed';
  run.error = `${stage.label} failed: ${message}`;
  touch(run);
  logger.error('pipeline run failed', { runId: run.id, stage: id, error: message });
}

/**
 * Marks one stage failed and leaves the run alone.
 *
 * Deliberately distinct from `failRun`: a sub-step can fail without making
 * the generated application invalid, and the graph-sync catch below used to
 * record exactly that case with `completeStage` — a failed write reported as
 * a completed stage, so the run claimed a graph it had never written.
 */
function failStage(run: PipelineRun, id: StageId, error: unknown): void {
  const stage = stageOf(run, id);
  stage.status = 'failed';
  stage.completedAt = new Date().toISOString();
  stage.durationMs = stage.startedAt
    ? Date.parse(stage.completedAt) - Date.parse(stage.startedAt)
    : null;
  stage.error = userFacingError(error);
  touch(run);
}

/**
 * Everything a user sees about a failure comes through here. Internal
 * details stay in the server log; the client gets a sentence it can act on.
 */
function userFacingError(error: unknown): string {
  if (AppError.isAppError(error) && error.isOperational) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/401|invalid api key/i.test(message)) return 'The configured AI key was rejected';
  if (/429|rate limit/i.test(message)) return 'The AI provider is rate limiting this key';
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) return 'The AI provider timed out';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return 'The AI provider could not be reached';
  }
  return 'An unexpected error interrupted this stage';
}

/**
 * Checks that a stage produced its artifact before it is allowed to report
 * success.
 *
 * `completeStage` believes whatever summary string it is handed, so a
 * generator that wrote nothing would still record a completed stage reading
 * "0 files · 0 modules" and the run would hand back an empty project as
 * though it were runnable. Throwing routes the stage through the normal
 * failure path, which is the truth. The missing artifact is logged because
 * `userFacingError` keeps an internal fault's text generic on purpose.
 */
function assertProduced(id: StageId, produced: boolean, artifact: string): void {
  if (produced) return;
  logger.error('stage produced no artifact', { stage: id, artifact });
  throw new Error(`${id} stage produced no ${artifact}`);
}

function recordUsage(run: PipelineRun, usage: AiCallStat | null): void {
  if (!usage) return;
  run.ai.calls += 1;
  run.ai.provider = usage.provider;
  run.ai.model = usage.model;
  run.ai.inputTokens += usage.inputTokens;
  run.ai.outputTokens += usage.outputTokens;
  run.ai.estimatedCostUsd = Number((run.ai.estimatedCostUsd + usage.costUsd).toFixed(6));
}

/**
 * The runnable file set. Generator output overlaid with the Security
 * Engine's hardened files — they share paths on purpose, so the real
 * authentication module replaces the generator's stubs. Running the
 * un-hardened set produces an app whose every route demands a token no
 * endpoint can issue.
 */
/**
 * The runnable file set: generator output with the hardened security files
 * laid over it. Exported because an edit re-assembles the same set from the
 * same parts, and a second copy of this rule would be a second chance to get
 * the precedence backwards.
 */
export function overlayFiles(
  base: { path: string; content: string }[],
  hardened: { path: string; content: string }[],
  prefix: string,
): { path: string; content: string }[] {
  const byPath = new Map(base.map((file) => [file.path, file.content]));
  for (const file of hardened) byPath.set(file.path, file.content);
  return [...byPath.entries()].map(([path, content]) => ({ path: `${prefix}/${path}`, content }));
}

async function execute(runId: string, prompt: string): Promise<void> {
  const entry = runs.get(runId);
  if (!entry) return;
  const { run } = entry;

  try {
    /* Stage 1 — requirement analysis (AI) */
    beginStage(run, 'analysis');
    const analysis = await analyzeWithAi(prompt, run.projectName);
    recordUsage(run, analysis.usage);
    const requirements = analysis.value;
    run.projectName = requirements.projectName;
    completeStage(
      run,
      'analysis',
      `${requirements.projectType} · ${requirements.modules.length} modules · ${requirements.database.length} entities`,
      { degraded: analysis.degraded, note: analysis.note },
    );

    /* Stage 2 — architecture planning (deterministic plan, AI column design) */
    beginStage(run, 'architecture');
    const { plan, markdown } = planArchitecture(requirements);
    const fields = await designEntityFields(plan.database.entities, {
      projectName: requirements.projectName,
      projectType: requirements.projectType,
    });
    recordUsage(run, fields.usage);
    plan.database.entities = fields.value;
    completeStage(
      run,
      'architecture',
      `${plan.apiModules.length} API modules · ${plan.database.entities.length} entities · ${plan.frontend.pages.length} pages`,
      { degraded: fields.degraded, note: fields.note },
    );

    /* Stage 3 — database design */
    beginStage(run, 'database');
    const design = designDatabase(plan, requirements);
    assertProduced('database', design.prismaSchema.trim() !== '', 'Prisma schema');
    const columnCount = design.databaseDesign.tables.reduce(
      (total, table) => total + table.columns.length,
      0,
    );
    completeStage(
      run,
      'database',
      `${design.integrity.stats.tables} tables · ${columnCount} columns · ${design.integrity.stats.relationships} relationships`,
    );

    /* Stage 4 — backend generation */
    beginStage(run, 'backend');
    const backend = generateBackend(
      plan,
      requirements,
      design.databaseDesign,
      design.prismaSchema,
      design.openapi,
      design.validationRules.entities,
      design.entityMetadata,
    );
    assertProduced('backend', backend.files.length > 0, 'files');
    completeStage(
      run,
      'backend',
      `${backend.files.length} files · ${backend.modules.length} modules · ${backend.routes.length} routes`,
    );

    /* Stage 5 — frontend generation */
    beginStage(run, 'frontend');
    const backendManifest = { modules: backend.modules, routes: backend.routes };
    // The one model call in this stage: the website's theme and sections.
    let siteDesign = await writeSiteDesign(prompt, requirements);
    recordUsage(run, siteDesign.usage);

    // Then check what came back against what was asked for. A model that
    // writes its own page can also quietly drop half the request, and the
    // build would otherwise succeed with a page nobody asked for. One
    // targeted retry, with the gaps named — bounded, because a loop here is
    // a loop that spends a user's tokens on a model that is not improving.
    let relevance = auditDomainRelevance(prompt, siteDesign.value, {
      modelAvailable: !siteDesign.degraded,
    });
    if (relevance.status === 'INCOMPLETE' && !siteDesign.degraded) {
      const retry = await writeSiteDesign(prompt, requirements, relevance.gaps);
      recordUsage(run, retry.usage);
      const retried = auditDomainRelevance(prompt, retry.value, {
        modelAvailable: !retry.degraded,
      });
      // Keep the better attempt, not the later one.
      if (!retry.degraded && retried.passed >= relevance.passed) {
        siteDesign = retry;
        relevance = retried;
      }
    }
    const frontend = generateFrontend(
      plan,
      requirements,
      design.databaseDesign,
      design.openapi,
      backendManifest,
      design.entityMetadata,
      siteDesign.value,
    );
    assertProduced('frontend', frontend.files.length > 0, 'files');
    completeStage(
      run,
      'frontend',
      `${frontend.files.length} files · ${frontend.pages.length} pages · ${frontend.components.length} components · ${summarizeRelevance(relevance)}`,
      {
        degraded: siteDesign.degraded,
        note:
          siteDesign.note ?? (relevance.status === 'PASS' ? null : summarizeRelevance(relevance)),
      },
    );

    /* Stage 6 — security hardening */
    beginStage(run, 'security');
    const security = applySecurity({
      requirements,
      architecture: plan,
      database: design.databaseDesign,
      openapi: design.openapi,
      entityMetadata: design.entityMetadata,
      backendManifest,
      frontendManifest: {
        pages: frontend.pages.map((page) => ({
          name: page.name,
          route: page.route,
          kind: page.kind,
          entity: page.entity,
          implemented: page.implemented,
        })),
      },
    });
    assertProduced('security', security.backendFiles.length > 0, 'hardened files');
    completeStage(
      run,
      'security',
      `grade ${security.report.grade} · score ${security.report.overallScore}/100 · ${security.report.findings.length} open findings · ${security.backendFiles.length + security.frontendFiles.length} hardened files`,
    );

    /* Stage 7 — dependency graph */
    beginStage(run, 'dependencies');
    const { bundle: dependencies } = buildDependencyGraphBundle({
      requirements,
      architecture: plan,
      database: design.databaseDesign,
      backend: { files: backend.files, modules: backend.modules, routes: backend.routes },
      frontend: {
        files: frontend.files,
        pages: frontend.pages,
        components: frontend.components,
        routes: frontend.routes,
        stores: frontend.stores,
      },
      security: {
        backendFiles: security.backendFiles,
        frontendFiles: security.frontendFiles,
        rbac: { roles: security.rbac.roles, permissions: security.permissions },
      },
    });
    assertProduced('dependencies', dependencies.stats.totalNodes > 0, 'graph nodes');
    completeStage(
      run,
      'dependencies',
      `${dependencies.stats.totalNodes} nodes · ${dependencies.stats.totalEdges} edges · ${dependencies.quality.circularDependencies.length} cycles`,
    );

    const artifacts: PipelineArtifacts = {
      runId: run.id,
      requirements,
      architecture: plan,
      architectureMarkdown: markdown,
      design,
      backend,
      frontend,
      security,
      dependencies,
      siteDesign: siteDesign.value,
      files: [
        ...overlayFiles(backend.files, security.backendFiles, 'backend'),
        ...overlayFiles(frontend.files, security.frontendFiles, 'frontend'),
      ],
    };
    entry.artifacts = artifacts;

    // Durably, as well as in memory. Until this existed a restart left the
    // project showing a completed build with no files behind it.
    if (run.projectId !== null) {
      const stored = await saveRunArtifacts(run.id, run.projectId, artifacts);
      if (!stored) {
        logger.warn('this run exists only in memory and will not survive a restart', {
          runId: run.id,
        });
      }
    }

    /* Stage 8 — engineering graph */
    beginStage(run, 'graph');
    if (run.projectId === null) {
      // A run started outside the API (a test, a script) has no project to
      // attach a graph to. Skipping is honest; failing the run would not be.
      skipStage(run, 'graph', 'no project attached to this run');
    } else {
      try {
        const sync = await synchronizeGraph(run.projectId, run.id, artifacts);
        completeStage(
          run,
          'graph',
          `${sync.nodeCount} nodes · ${sync.edgeCount} edges · ${sync.nodesCreated} new`,
        );
      } catch (error) {
        // The graph is an index built over the generated project, not part of
        // it: a sync that failed leaves the app just as runnable, so this one
        // stage fails and the run below still completes. Only the stage is
        // marked — completing it, as this path used to, reported a graph that
        // does not exist.
        failStage(run, 'graph', error);
        logger.warn('engineering graph sync failed', { runId: run.id, error });
      }
    }

    run.status = 'completed';
    touch(run);
    emit(run, 'settled');
    logger.info('pipeline run completed', {
      runId: run.id,
      projectName: run.projectName,
      files: artifacts.files.length,
      aiCalls: run.ai.calls,
    });
  } catch (error) {
    const active = run.stages.find((stage) => stage.status === 'running');
    failRun(run, active?.id ?? 'analysis', error);
    emit(run, 'settled');
  }
}

export function startRun(input: StartRunInput, ownerId: string | null = null): PipelineRun {
  const prompt = input.prompt.trim();
  const trimmedName = input.projectName?.trim();
  const projectName =
    trimmedName === undefined || trimmedName === '' ? deriveProjectName(prompt) : trimmedName;
  const now = new Date().toISOString();

  const run: PipelineRun = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    projectName,
    prompt,
    status: 'running',
    stages: newStages(),
    ai: {
      calls: 0,
      provider: 'none',
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  runs.set(run.id, { run, artifacts: null, ownerId });
  // Oldest first — Map preserves insertion order.
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }

  emit(run, 'started');
  void execute(run.id, prompt);
  return run;
}

export function getRun(id: string, ownerId: string | null = null): PipelineRun {
  return ownedEntry(id, ownerId).run;
}

export function listRuns(ownerId: string | null = null): PipelineRun[] {
  return [...runs.values()]
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => entry.run)
    .reverse();
}

/**
 * The artifact bundle if this process still holds it, or null.
 *
 * Distinct from `getArtifacts`, which throws: a caller assembling optional
 * context wants "not available" as a value it can record, not an exception
 * that aborts the request.
 */
export function getArtifactsIfReady(id: string): PipelineArtifacts | null {
  return runs.get(id)?.artifacts ?? null;
}

/**
 * The bundle for a run, from memory or from storage.
 *
 * The in-memory map holds the last twenty runs of this process; everything
 * older, and everything from before a restart, is read back from the database
 * and cached so the next caller finds it in memory. `null` means it is
 * genuinely unavailable — never written, pruned, or from a build whose shape
 * this one does not read — and callers must say so rather than imply the run
 * produced nothing.
 */
export async function loadArtifacts(
  id: string,
  ownerId: string | null = null,
): Promise<PipelineArtifacts | null> {
  const entry = runs.get(id);
  if (entry?.artifacts) {
    // Ownership is only checkable for a run this process still knows about;
    // for a rehydrated one the caller has already resolved the project.
    if (ownerId !== null && entry.ownerId !== ownerId) return null;
    return entry.artifacts;
  }

  const stored = await loadRunArtifacts(id);
  if (!stored) return null;
  if (entry) entry.artifacts = stored;
  return stored;
}

export function getArtifacts(id: string, ownerId: string | null = null): PipelineArtifacts {
  const entry = ownedEntry(id, ownerId);
  if (!entry.artifacts) {
    throw AppError.badRequest(
      entry.run.status === 'failed'
        ? 'This run failed before it produced any artifacts'
        : 'This run is still generating — poll the run until it completes',
    );
  }
  return entry.artifacts;
}

/** Re-runs the same prompt as a fresh run; the failed one stays in history. */
export function retryRun(
  id: string,
  projectId: string | null,
  ownerId: string | null = null,
): PipelineRun {
  const entry = ownedEntry(id, ownerId);
  return startRun(
    {
      prompt: entry.run.prompt,
      projectName: entry.run.projectName,
      projectId: projectId ?? entry.run.projectId ?? undefined,
    },
    ownerId,
  );
}

/* ── Artifact addressing ──────────────────────────────────────────────── */

/** What this run produced, described without transferring any of it. */
export function listArtifacts(id: string, ownerId: string | null = null): ArtifactDescriptor[] {
  const entry = ownedEntry(id, ownerId);
  if (!entry.artifacts) return [];
  return describeAll(entry.artifacts, entry.run.projectId ?? '', entry.run.createdAt);
}

/** One artifact by type — the selective read the whole-bundle endpoint cannot do. */
export function getArtifact(id: string, type: string, ownerId: string | null = null): unknown {
  if (!isArtifactType(type)) {
    throw AppError.badRequest(`Unknown artifact type "${type}"`);
  }
  const artifacts = getArtifacts(id, ownerId);
  const value = selectArtifact(artifacts, type);
  if (value === null) throw AppError.notFound(`This run produced no "${type}" artifact`);
  return value;
}

/**
 * Record an edited file set as this project's newest run.
 *
 * An edit produces a new version of exactly the thing a run produces — a
 * requirement spec, an architecture, a file set — so it is recorded as a run
 * rather than as a parallel kind of object. That is not bookkeeping for its
 * own sake: Preview, Code, the Knowledge Graph and the project's history all
 * read "the project's latest completed run", and an edit that did not become
 * one would be invisible to every one of them.
 *
 * The stages are supplied by the caller because an edit genuinely did not run
 * the eight generation stages; reporting stages it never ran would be the
 * kind of invented evidence this platform refuses elsewhere.
 */
export async function registerEditedRun(input: {
  projectId: string;
  projectName: string;
  ownerId: string | null;
  /** The instruction that produced this version, kept as the run's prompt. */
  prompt: string;
  artifacts: Omit<PipelineArtifacts, 'runId'>;
  stages: PipelineStage[];
  ai: PipelineRun['ai'];
}): Promise<PipelineRun> {
  const now = new Date().toISOString();
  const run: PipelineRun = {
    id: randomUUID(),
    projectId: input.projectId,
    projectName: input.projectName,
    prompt: input.prompt,
    status: 'completed',
    stages: input.stages,
    ai: input.ai,
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  const artifacts: PipelineArtifacts = { ...input.artifacts, runId: run.id };
  runs.set(run.id, { run, artifacts, ownerId: input.ownerId });
  await saveRunArtifacts(run.id, input.projectId, artifacts);
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }

  await openRun(run.id, input.projectId, input.prompt);
  await closeRun(run.id, 'COMPLETED');
  emit(run, 'settled');
  return run;
}
