/**
 * The Context Engine's public surface.
 *
 * Resolve → select artifacts → compile → budget → sanitize, with a cache
 * in front and a trace out the back. Nothing here calls a model: the
 * engine's entire job is to decide what a model should be told, and that
 * decision is deterministic so it can be reproduced, explained and tested.
 *
 * Ownership is enforced the same way every project-scoped read in this
 * codebase enforces it — by resolving the project through the caller's id
 * before any graph or artifact is touched.
 */
import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { loadEdges, loadNodes } from '../engineering-graph/lib/graph-repository.js';
import { getArtifactsIfReady } from '../pipeline/pipeline.service.js';
import { selectArtifact } from '../pipeline/lib/artifact-index.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import { budgetFor, fitToProvider } from './lib/budgets.js';
import { cacheKey, readCache, writeCache } from './lib/context-cache.js';
import { compileContext } from './lib/compiler.js';
import { resolveContext } from './lib/resolver.js';
import { selectArtifacts } from './lib/artifact-selector.js';
import type { ArtifactType } from '../../shared/contracts/index.js';
import type { CompiledContext, ContextRequest } from './context-engine.types.js';

/**
 * The default models' context window. Used only to bound the FULL control
 * arm — never as a target to fill.
 */
const MODEL_CONTEXT_WINDOW = 131_072;

/** The model the compiled context will be counted against. */
function activeModel(): string {
  const configured = process.env.AI_MODEL_DEEP?.trim();
  return configured !== undefined && configured !== '' ? configured : 'openai/gpt-oss-120b';
}

/**
 * Builds the context for one task.
 *
 * A project whose graph has not been built yet is a `404`, not an empty
 * context: silently returning nothing would let a caller send a model an
 * empty brief and treat the result as real.
 */
export async function buildContext(
  ownerId: string,
  request: ContextRequest,
): Promise<CompiledContext> {
  const startedAt = Date.now();
  await getProjectOrThrow(ownerId, request.projectId);

  const [nodes, edges] = await Promise.all([
    loadNodes(request.projectId),
    loadEdges(request.projectId),
  ]);

  if (nodes.length === 0) {
    throw AppError.notFound(
      'This project has no engineering graph yet — run the pipeline before requesting context',
    );
  }

  // Any change to the graph changes this, so a cached context can never
  // outlive the artifacts it described.
  const graphVersion = `${String(nodes.length)}:${String(edges.length)}:${nodes.reduce(
    (latest, node) => (node.updatedAt > latest ? node.updatedAt : latest),
    '',
  )}`;
  const key = cacheKey(request, graphVersion);
  const cached = readCache(key);
  if (cached) {
    return { ...cached, trace: { ...cached.trace, cache: 'hit' } };
  }

  const budget = budgetFor(request.taskType);
  const mode = request.mode ?? 'SELECTIVE';

  /**
   * FULL is the control arm and has to measure honestly.
   *
   * Applying the task's context budget to it would truncate the very thing
   * it exists to measure, and the comparison would then be between two
   * budgeted contexts rather than between selection and no selection. So
   * FULL is bounded only by the model's own window, and the benchmark
   * reports whether the result would even have fit.
   */
  const maxContextTokens =
    request.maxTokens ?? (mode === 'FULL' ? MODEL_CONTEXT_WINDOW : budget.maxContextTokens);

  /* Selection. */
  const resolution = resolveContext(nodes, edges, request);

  /* Artifacts the selected nodes imply. */
  const artifactPlan = selectArtifacts(
    request.taskType,
    resolution.selected,
    request.requiredArtifactTypes,
    request.includeSourceFiles ?? false,
  );

  const artifacts: Partial<Record<ArtifactType, unknown>> = {};
  const unavailable: { type: ArtifactType; reason: 'unavailable' }[] = [];

  // Artifact content is process-local, so a run from before a restart has
  // a graph but no bundle. That is a thinner context, not a failure.
  const bundle = request.runId ? getArtifactsIfReady(request.runId) : null;
  for (const type of artifactPlan.needed) {
    if (!bundle) {
      unavailable.push({ type, reason: 'unavailable' });
      continue;
    }
    const value = selectArtifact(bundle, type);
    if (value === null || value === undefined) unavailable.push({ type, reason: 'unavailable' });
    else artifacts[type] = value;
  }

  /* Compilation, budgeting, compression, sanitization. */
  const compiled = compileContext({
    projectId: request.projectId,
    runId: request.runId ?? null,
    taskType: request.taskType,
    mode,
    instruction: request.instruction,
    selected: resolution.selected,
    artifacts,
    maxContextTokens,
    maxOutputTokens: budget.maxOutputTokens,
    model: activeModel(),
    startedAt,
    trace: {
      selected: resolution.selected.map((entry) => ({
        nodeId: entry.node.id,
        name: entry.node.name,
        type: entry.node.type,
        reason: entry.reason,
        score: entry.score,
        depth: entry.depth,
      })),
      // Bounded: a full exclusion list on a large graph is bigger than the
      // context it describes.
      excluded: resolution.excluded.slice(0, 100),
      artifactsIncluded: Object.keys(artifacts) as ArtifactType[],
      artifactsExcluded: [...artifactPlan.excluded, ...unavailable],
      cache: 'miss',
      graphNodesConsidered: resolution.considered,
    },
  });

  // The compiled size is only known now, so the provider clamp lands here:
  // the context keeps its ceiling and the output allowance absorbs the cut.
  const fitted = fitToProvider(maxContextTokens, budget.maxOutputTokens, compiled.tokens);
  compiled.budget.maxOutputTokens = fitted.maxOutputTokens;
  if (fitted.clamped) {
    logger.debug('output allowance clamped to the provider request limit', {
      task: request.taskType,
      contextTokens: compiled.tokens,
      maxOutputTokens: fitted.maxOutputTokens,
    });
  }

  writeCache(key, compiled);

  logger.debug('context compiled', {
    projectId: request.projectId,
    task: request.taskType,
    mode: compiled.mode,
    nodes: resolution.selected.length,
    excluded: resolution.excluded.length,
    tokens: compiled.tokens,
    budget: maxContextTokens,
    withinBudget: compiled.budget.withinBudget,
    redactions: compiled.trace.sanitization.redactions,
  });

  return compiled;
}

/**
 * Expands the request and rebuilds when the first attempt found too
 * little. Step 23's fallback: widen the graph, never fall back to sending
 * the whole project.
 */
export async function buildContextWithFallback(
  ownerId: string,
  request: ContextRequest,
): Promise<CompiledContext> {
  const first = await buildContext(ownerId, request);
  const targets = first.trace.selected.filter((entry) => entry.reason === 'TARGET').length;

  // "Too little" means the selection barely reached past its own targets
  // while the budget still had plenty of room.
  const thin = first.trace.selected.length <= targets + 1;
  const roomLeft = first.tokens < first.budget.maxContextTokens * 0.5;
  if (!thin || !roomLeft) return first;

  const budget = budgetFor(request.taskType);
  const widened = await buildContext(ownerId, {
    ...request,
    dependencyDepth: Math.min((request.dependencyDepth ?? budget.defaultDepth) + 1, 4),
    includeDependents: true,
  });

  logger.info('context widened after a thin first pass', {
    projectId: request.projectId,
    task: request.taskType,
    before: first.trace.selected.length,
    after: widened.trace.selected.length,
  });
  return widened;
}
