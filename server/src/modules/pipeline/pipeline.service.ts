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
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import { analyzeWithAi, deriveProjectName, designEntityFields } from './lib/ai-stages.js';
import type { AiCallStat } from './lib/ai-stages.js';
import type {
  PipelineArtifacts,
  PipelineRun,
  PipelineStage,
  StageId,
  StartRunInput,
} from './pipeline.types.js';

const STAGE_TEMPLATE: readonly { id: StageId; label: string; engine: 'ai' | 'deterministic' }[] = [
  { id: 'analysis', label: 'Requirement Analysis', engine: 'ai' },
  { id: 'architecture', label: 'Architecture Planning', engine: 'ai' },
  { id: 'database', label: 'Database Design', engine: 'deterministic' },
  { id: 'backend', label: 'Backend Generation', engine: 'deterministic' },
  { id: 'frontend', label: 'Frontend Generation', engine: 'deterministic' },
  { id: 'security', label: 'Security Hardening', engine: 'deterministic' },
  { id: 'dependencies', label: 'Dependency Graph', engine: 'deterministic' },
];

/** Runs are process-local, like every other generator cache in this platform. */
const MAX_RUNS = 20;
const runs = new Map<string, { run: PipelineRun; artifacts: PipelineArtifacts | null }>();

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
function overlayFiles(
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
    completeStage(
      run,
      'backend',
      `${backend.files.length} files · ${backend.modules.length} modules · ${backend.routes.length} routes`,
    );

    /* Stage 5 — frontend generation */
    beginStage(run, 'frontend');
    const backendManifest = { modules: backend.modules, routes: backend.routes };
    const frontend = generateFrontend(
      plan,
      requirements,
      design.databaseDesign,
      design.openapi,
      backendManifest,
      design.entityMetadata,
    );
    completeStage(
      run,
      'frontend',
      `${frontend.files.length} files · ${frontend.pages.length} pages · ${frontend.components.length} components`,
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
      files: [
        ...overlayFiles(backend.files, security.backendFiles, 'backend'),
        ...overlayFiles(frontend.files, security.frontendFiles, 'frontend'),
      ],
    };
    entry.artifacts = artifacts;

    run.status = 'completed';
    touch(run);
    logger.info('pipeline run completed', {
      runId: run.id,
      projectName: run.projectName,
      files: artifacts.files.length,
      aiCalls: run.ai.calls,
    });
  } catch (error) {
    const active = run.stages.find((stage) => stage.status === 'running');
    failRun(run, active?.id ?? 'analysis', error);
  }
}

export function startRun(input: StartRunInput): PipelineRun {
  const prompt = input.prompt.trim();
  const trimmedName = input.projectName?.trim();
  const projectName =
    trimmedName === undefined || trimmedName === '' ? deriveProjectName(prompt) : trimmedName;
  const now = new Date().toISOString();

  const run: PipelineRun = {
    id: randomUUID(),
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

  runs.set(run.id, { run, artifacts: null });
  // Oldest first — Map preserves insertion order.
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }

  void execute(run.id, prompt);
  return run;
}

export function getRun(id: string): PipelineRun {
  const entry = runs.get(id);
  if (!entry) throw AppError.notFound('That generation run no longer exists — start a new one');
  return entry.run;
}

export function listRuns(): PipelineRun[] {
  return [...runs.values()].map((entry) => entry.run).reverse();
}

export function getArtifacts(id: string): PipelineArtifacts {
  const entry = runs.get(id);
  if (!entry) throw AppError.notFound('That generation run no longer exists — start a new one');
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
export function retryRun(id: string): PipelineRun {
  const entry = runs.get(id);
  if (!entry) throw AppError.notFound('That generation run no longer exists — start a new one');
  return startRun({ prompt: entry.run.prompt, projectName: entry.run.projectName });
}
