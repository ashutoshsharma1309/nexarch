/**
 * The Builder Agent's tools — each a thin, validated front door to a system
 * the platform already has. The agent never touches files, processes or URLs
 * directly: it asks these tools, and they ask the real services.
 *
 *   create_project  → workspace (a project row the user can open)
 *   build_app       → the generation pipeline (analysis → … → graph)
 *   review_app      → the 14-agent mesh (planning, generation, review, runtime, tests)
 *   repair_app      → the self-repair engine
 *   preview_app     → the local runner (install, database, start, health)
 *   inspect_website → HTTP checks against the preview the runner reported
 *   list_files / read_file → the generated artifacts, read-only
 *
 * Trust boundaries: arguments come from a model, so every one is validated;
 * identifiers that matter (project, run, preview) come from the session's own
 * state, never from arguments; `inspect_website` only fetches the local URLs
 * the runner handed back, so a model cannot point it anywhere (no SSRF); and
 * file access is to generated artifacts in memory, never the filesystem.
 */
import { z } from 'zod';

import {
  getRepairs,
  getRun as getAgentRun,
  getValidation,
  listProjectFindings,
  startRepairSession,
  startRun as startAgentRun,
} from '../../agent-orchestrator/agent-orchestrator.service.js';
import {
  getArtifacts,
  getRun as getPipelineRun,
  startRun as startPipelineRun,
} from '../../pipeline/pipeline.service.js';
import { createSession, getSession, stopSession } from '../../runner/runner.service.js';
import { createProject } from '../../workspace/workspace.service.js';
import type { ValidationSummary } from '../../../shared/types/validation.js';
import type { BuilderSession, BuilderToolName } from '../builder-agent.types.js';

export interface ToolContext {
  ownerId: string;
  session: BuilderSession;
  /** Flipped by cancel; long waits check it between polls. */
  isCancelled: () => boolean;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface BuilderTool {
  name: BuilderToolName;
  description: string;
  /** Argument contract, validated before `run` ever sees the input. */
  args: z.ZodType<Record<string, unknown>>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

/* ── Waiting on the real systems ──────────────────────────────────────── */

class ToolTimeoutError extends Error {}
class ToolCancelledError extends Error {}

async function waitFor<T>(
  ctx: ToolContext,
  read: () => T | Promise<T>,
  settled: (value: T) => boolean,
  options: { timeoutMs: number; intervalMs?: number; what: string },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (ctx.isCancelled()) throw new ToolCancelledError('Cancelled');
    const value = await read();
    if (settled(value)) return value;
    if (Date.now() >= deadline) {
      throw new ToolTimeoutError(
        `${options.what} did not finish within ${String(Math.round(options.timeoutMs / 60_000))} minutes`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 1_500));
  }
}

function fail(summary: string, detail?: Record<string, unknown>): ToolResult {
  return { ok: false, summary, ...(detail ? { detail } : {}) };
}

function requireState<K extends keyof BuilderSession['state']>(
  ctx: ToolContext,
  key: K,
  hint: string,
): NonNullable<BuilderSession['state'][K]> {
  const value = ctx.session.state[key];
  if (value === null) throw new PreconditionError(hint);
  return value;
}

export class PreconditionError extends Error {}

/**
 * A new build makes the running preview stale: whatever it serves — and
 * whatever an inspection saw — describes the previous build. Completion then
 * needs a fresh preview and inspection of this one.
 */
export function markBuilt(state: BuilderSession['state'], degraded: boolean): void {
  state.buildDegraded = degraded;
  state.frontendUrl = null;
  state.backendUrl = null;
  state.inspected = false;
}

/** The landing page's sections, read from the generated content module. */
export function landingSectionsOf(siteModule: string): string[] {
  const literal =
    /export const site(?:: SiteContent)? = ([\s\S]*?);\s*(?:\/\/# sourceMappingURL|$)/.exec(
      siteModule,
    )?.[1];
  if (!literal) return [];
  const keys = ['features', 'pricing', 'testimonials', 'faq'] as const;
  try {
    const site = JSON.parse(literal) as Record<string, unknown>;
    return ['hero', ...keys.filter((key) => Array.isArray(site[key]) && site[key].length > 0)];
  } catch {
    // Served through a dev server the literal is transformed JavaScript, not
    // strict JSON: fall back to "does this key hold a non-empty list".
    return [
      'hero',
      ...keys.filter((key) => new RegExp(`["']?${key}["']?\\s*:\\s*\\[\\s*\\{`).test(literal)),
    ];
  }
}

function generatedFiles(ctx: ToolContext): { path: string; content: string }[] {
  const runId = requireState(ctx, 'pipelineRunId', 'Build the app first (build_app).');
  return getArtifacts(runId, ctx.ownerId).files;
}

/* ── The tools ────────────────────────────────────────────────────────── */

const noArgs = z.object({}).passthrough();

const createProjectTool: BuilderTool = {
  name: 'create_project',
  description:
    'Create the workspace project the website will live in. Args: { "name": string (2-60 chars), "description"?: string }.',
  args: z.object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(240).optional(),
  }),
  async run(ctx, args) {
    if (ctx.session.state.projectId) {
      return fail(`Project already created (${ctx.session.state.projectName ?? ''}).`);
    }
    const input = args as { name: string; description?: string };
    const project = await createProject(ctx.ownerId, {
      name: input.name,
      description: input.description ?? ctx.session.task.slice(0, 240),
    });
    ctx.session.state.projectId = project.id;
    ctx.session.state.projectName = project.name;
    return {
      ok: true,
      summary: `Created project "${project.name}".`,
      detail: { projectId: project.id },
    };
  },
};

const buildAppTool: BuilderTool = {
  name: 'build_app',
  description:
    'Run the generation pipeline for the project: requirement analysis, architecture, database, backend, frontend with a public landing page, security hardening, dependency graph. Args: { "prompt": string — the full description of what to build }.',
  args: z.object({ prompt: z.string().trim().min(10).max(4_000) }),
  async run(ctx, args) {
    const projectId = requireState(ctx, 'projectId', 'Create the project first (create_project).');
    if (ctx.session.state.buildDegraded === false) {
      return fail(
        'Already built with no fallback stages — a rebuild would produce the same app. Preview or inspect it instead.',
      );
    }
    const { prompt } = args as { prompt: string };
    const started = startPipelineRun(
      { prompt, projectId, projectName: ctx.session.state.projectName ?? undefined },
      ctx.ownerId,
    );
    ctx.session.state.pipelineRunId = started.id;
    const run = await waitFor(
      ctx,
      () => getPipelineRun(started.id, ctx.ownerId),
      (value) => value.status !== 'running',
      { timeoutMs: 6 * 60_000, intervalMs: 1_000, what: 'The build' },
    );
    const stages = run.stages.map((stage) => ({
      stage: stage.id,
      status: stage.status,
      summary: stage.summary,
      fallback: stage.degraded,
    }));
    if (run.status !== 'completed') {
      return fail(`Build failed: ${run.error ?? 'unknown error'}`, { stages });
    }
    markBuilt(
      ctx.session.state,
      run.stages.some((stage) => stage.degraded),
    );
    const site = generatedFiles(ctx).find((f) => f.path.endsWith('src/content/site.ts'));
    ctx.session.state.landingSections = site ? landingSectionsOf(site.content) : [];
    const frontend = run.stages.find((stage) => stage.id === 'frontend')?.summary ?? '';
    return {
      ok: true,
      summary: `Built: ${frontend}. Landing page sections: ${ctx.session.state.landingSections.join(', ') || 'none'}.`,
      detail: {
        runId: run.id,
        stages,
        ai: run.ai,
        landingSections: ctx.session.state.landingSections,
      },
    };
  },
};

const reviewAppTool: BuilderTool = {
  name: 'review_app',
  description:
    'Run the 14-agent mesh on the project: planning, generation, security/dependency/code-quality review, then build, start and test the app. Returns the validation gate and findings. Args: {}.',
  args: noArgs,
  async run(ctx) {
    const projectId = requireState(ctx, 'projectId', 'Create the project first (create_project).');
    requireState(ctx, 'pipelineRunId', 'Build the app first (build_app).');
    const started = await startAgentRun(ctx.ownerId, { projectId, prompt: ctx.session.task });
    ctx.session.state.agentRunId = started.run.id;
    const finished = await waitFor(
      ctx,
      () => getAgentRun(ctx.ownerId, started.run.id),
      (view) => !['PENDING', 'RUNNING'].includes(view.run.status),
      { timeoutMs: 20 * 60_000, intervalMs: 2_000, what: 'The agent review' },
    );
    const agents = finished.run.tasks.map((task) => ({ agent: task.agentId, status: task.status }));
    const completed = agents.filter((agent) => agent.status === 'COMPLETED').length;

    const validation = await getValidation(ctx.ownerId, projectId);
    const summary = validation.summary as ValidationSummary | null;
    const findings = await listProjectFindings(ctx.ownerId, projectId);
    const bySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
      return acc;
    }, {});
    ctx.session.state.validationGate = summary?.gate ?? null;

    const detail = {
      agentRunId: finished.run.id,
      agents,
      gate: summary?.gate ?? null,
      checks:
        summary?.rows.map((row) => ({ check: row.name, status: row.status, detail: row.detail })) ??
        [],
      findings: bySeverity,
    };
    if (finished.run.status !== 'COMPLETED') {
      return fail(
        `Review ${finished.run.status.toLowerCase()} (${String(completed)}/${String(agents.length)} agents): ${finished.run.error ?? ''}`,
        detail,
      );
    }
    return {
      ok: true,
      summary: `${String(completed)}/${String(agents.length)} agents completed. Validation gate ${summary?.gate ?? 'n/a'}; ${String(findings.length)} findings.`,
      detail,
    };
  },
};

const repairAppTool: BuilderTool = {
  name: 'repair_app',
  description:
    'Run the self-repair engine over open findings. It fixes only what it can prove fixed and routes the rest to review. Args: {}.',
  args: noArgs,
  async run(ctx) {
    const projectId = requireState(ctx, 'projectId', 'Create the project first (create_project).');
    requireState(
      ctx,
      'agentRunId',
      'Review the app first (review_app) — repair works on its findings.',
    );
    await startRepairSession(ctx.ownerId, projectId);
    const outcome = await waitFor(
      ctx,
      () => getRepairs(ctx.ownerId, projectId),
      (value) => value.session !== null && value.session.status !== 'RUNNING',
      { timeoutMs: 12 * 60_000, intervalMs: 2_000, what: 'The repair session' },
    );
    ctx.session.state.repaired = true;
    const counts = outcome.session?.counts;
    return {
      ok: outcome.session?.status === 'COMPLETED',
      summary: `Repair ${outcome.session?.finalState ?? 'unknown'}: ${String(counts?.fixed ?? 0)} fixed, ${String(counts?.requiresReview ?? 0)} for review, ${String(counts?.rolledBack ?? 0)} rolled back.`,
      detail: { finalState: outcome.session?.finalState ?? null, counts: counts ?? null },
    };
  },
};

const previewAppTool: BuilderTool = {
  name: 'preview_app',
  description:
    'Install and start the built website locally (backend, database, frontend) and wait until it answers. Args: {}.',
  args: noArgs,
  async run(ctx) {
    const runId = requireState(ctx, 'pipelineRunId', 'Build the app first (build_app).');
    const artifacts = getArtifacts(runId, ctx.ownerId);
    // One live website per session: a restart replaces the previous preview
    // instead of leaving it running beside the new one.
    const previous = ctx.session.state.previewSessionId;
    if (previous) {
      try {
        stopSession(previous, ctx.ownerId);
      } catch {
        // Already stopped or failed — nothing to release.
      }
      ctx.session.state.frontendUrl = null;
      ctx.session.state.backendUrl = null;
      ctx.session.state.inspected = false;
    }
    const created = createSession(
      { projectName: artifacts.architecture.meta.projectName, files: artifacts.files },
      ctx.ownerId,
    );
    ctx.session.state.previewSessionId = created.id;
    const session = await waitFor(
      ctx,
      () => getSession(created.id, ctx.ownerId),
      (value) => ['running', 'failed', 'stopped'].includes(value.phase),
      { timeoutMs: 15 * 60_000, intervalMs: 2_000, what: 'The preview' },
    );
    const frontend = session.processes.find((p) => p.kind === 'frontend');
    const backend = session.processes.find((p) => p.kind === 'backend');
    if (session.phase !== 'running') {
      return fail(`Preview ${session.phase}: ${(session.diagnostics ?? []).join(' ')}`, {
        phase: session.phase,
        diagnostics: session.diagnostics,
      });
    }
    ctx.session.state.frontendUrl = frontend?.url ?? null;
    ctx.session.state.backendUrl = backend?.url ?? null;
    return {
      ok: true,
      summary: `Website running at ${frontend?.url ?? '—'} (API ${backend?.url ?? '—'}).`,
      detail: {
        sessionId: session.id,
        frontendUrl: frontend?.url ?? null,
        backendUrl: backend?.url ?? null,
      },
    };
  },
};

async function probe(url: string): Promise<{ status: number | null; body: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: (await response.text()).slice(0, 20_000) };
  } catch {
    return { status: null, body: '' };
  }
}

const inspectWebsiteTool: BuilderTool = {
  name: 'inspect_website',
  description:
    'Check the running website like a visitor would: the page loads, the landing page and its content are served, the API answers through the site and reports its database. Args: {}.',
  args: noArgs,
  async run(ctx) {
    // Only ever the URLs the runner reported — never an argument.
    const site = requireState(ctx, 'frontendUrl', 'Start the preview first (preview_app).');
    const api = ctx.session.state.backendUrl;

    const [page, landing, content, proxied, health] = await Promise.all([
      probe(`${site}/`),
      probe(`${site}/src/features/landing/LandingPage.tsx`),
      probe(`${site}/src/content/site.ts`),
      probe(`${site}/api/v1/health`),
      api ? probe(`${api}/api/v1/health`) : Promise.resolve({ status: null, body: '' }),
    ]);

    const sections = landingSectionsOf(content.body);
    const databaseUp = /"database"\s*:\s*"up"/.test(health.body);
    const checks = [
      {
        check: 'page loads',
        ok: page.status === 200 && page.body.includes('id="root"'),
        status: page.status,
      },
      { check: 'landing page served', ok: landing.status === 200, status: landing.status },
      { check: 'landing content present', ok: sections.length > 1, sections },
      {
        check: 'API reachable through the site',
        ok: proxied.status === 200,
        status: proxied.status,
      },
      { check: 'API reports its database', ok: databaseUp, status: health.status },
    ];
    const passed = checks.filter((check) => check.ok).length;
    const essential = checks.slice(0, 4).every((check) => check.ok);
    ctx.session.state.inspected = essential;
    if (sections.length > 0) ctx.session.state.landingSections = sections;
    return {
      ok: essential,
      summary: `${String(passed)}/${String(checks.length)} website checks passed${
        essential
          ? ''
          : ` — failing: ${checks
              .filter((c) => !c.ok)
              .map((c) => c.check)
              .join(', ')}`
      }.`,
      detail: { url: site, checks },
    };
  },
};

const listFilesTool: BuilderTool = {
  name: 'list_files',
  description:
    'List generated file paths, optionally filtered by a substring. Args: { "filter"?: string }.',
  args: z.object({ filter: z.string().trim().max(80).optional() }),
  run(ctx, args) {
    const { filter } = args as { filter?: string };
    const paths = generatedFiles(ctx)
      .map((f) => f.path)
      .filter((path) => !filter || path.includes(filter));
    return Promise.resolve({
      ok: true,
      summary: `${String(paths.length)} file(s)${filter ? ` matching "${filter}"` : ''}.`,
      detail: { paths: paths.slice(0, 60), truncated: paths.length > 60 },
    });
  },
};

const readFileTool: BuilderTool = {
  name: 'read_file',
  description:
    'Read one generated file by its exact path (first 3000 characters). Args: { "path": string }.',
  args: z.object({ path: z.string().trim().min(1).max(300) }),
  run(ctx, args) {
    const { path } = args as { path: string };
    const found = generatedFiles(ctx).find((f) => f.path === path);
    if (!found) return Promise.resolve(fail(`No generated file at ${path}.`));
    return Promise.resolve({
      ok: true,
      summary: `${path} (${String(found.content.length)} characters).`,
      detail: {
        path,
        content: found.content.slice(0, 3_000),
        truncated: found.content.length > 3_000,
      },
    });
  },
};

const finishTool: BuilderTool = {
  name: 'finish',
  description:
    'End the task. Use when the website is running and inspected, or when it cannot be. Args: {}.',
  args: noArgs,
  run: () => Promise.resolve({ ok: true, summary: 'Finished.' }),
};

export const TOOLS: readonly BuilderTool[] = [
  createProjectTool,
  buildAppTool,
  reviewAppTool,
  repairAppTool,
  previewAppTool,
  inspectWebsiteTool,
  listFilesTool,
  readFileTool,
  finishTool,
];

export function toolByName(name: string): BuilderTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** The catalogue as the model sees it — names and contracts, nothing else. */
export function describeTools(): string {
  return TOOLS.map((tool) => `- \`${tool.name}\` — ${tool.description}`).join('\n');
}

/** Normalizes any tool failure into a result the loop can record and the model can read. */
export async function runTool(
  tool: BuilderTool,
  ctx: ToolContext,
  rawArgs: unknown,
): Promise<ToolResult> {
  const parsed = tool.args.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return fail(
      `Invalid arguments for ${tool.name}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'args'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  try {
    return await tool.run(ctx, parsed.data);
  } catch (error) {
    if (error instanceof PreconditionError) return fail(error.message);
    if (error instanceof ToolTimeoutError || error instanceof ToolCancelledError) {
      return fail(error.message);
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}
