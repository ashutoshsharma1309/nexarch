/**
 * Inspection endpoints for the Context Engine.
 *
 * These exist so a context can be *examined* before anyone trusts it —
 * what was selected, what was excluded and why, what it cost, what was
 * redacted. A selection nobody can inspect is indistinguishable from a
 * guess.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { GRAPH_NODE_TYPES } from '../../shared/contracts/index.js';
import { buildContext, buildContextWithFallback } from './context-engine.service.js';
import { runBenchmark } from './lib/benchmark.js';
import { cacheSize } from './lib/context-cache.js';
import { tokenAccuracy } from './lib/token-counter.js';
import { TASK_TYPES } from './context-engine.types.js';
import type { ContextMode, ContextRequest, TaskType } from './context-engine.types.js';
import type { ArtifactType, GraphNodeType } from '../../shared/contracts/index.js';

function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

/** Narrows an untrusted body into a `ContextRequest`, rejecting rather than coercing. */
function readRequest(req: Request): ContextRequest {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = req.params.projectId as string;

  const rawTask = typeof body.taskType === 'string' ? body.taskType : '';
  const taskType = rawTask.toUpperCase();
  if (!(TASK_TYPES as string[]).includes(taskType)) {
    throw AppError.badRequest(`taskType must be one of: ${TASK_TYPES.join(', ')}`);
  }

  const nodeTypes = Array.isArray(body.requiredNodeTypes)
    ? (body.requiredNodeTypes as string[]).map((value) => value.toUpperCase())
    : undefined;
  if (nodeTypes?.some((value) => !(GRAPH_NODE_TYPES as string[]).includes(value))) {
    throw AppError.badRequest('requiredNodeTypes contains an unknown node type');
  }

  const depth = body.dependencyDepth;
  if (depth !== undefined && (typeof depth !== 'number' || depth < 0 || depth > 4)) {
    throw AppError.badRequest('dependencyDepth must be between 0 and 4');
  }

  const maxTokens = body.maxTokens;
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || maxTokens < 200)) {
    throw AppError.badRequest('maxTokens must be at least 200');
  }

  const rawMode = typeof body.mode === 'string' ? body.mode.toUpperCase() : undefined;
  const mode: ContextMode | undefined =
    rawMode === 'SELECTIVE' || rawMode === 'FULL' ? rawMode : undefined;
  if (rawMode !== undefined && mode === undefined) {
    throw AppError.badRequest('mode must be SELECTIVE or FULL');
  }

  const asStrings = (value: unknown): string[] | undefined =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : undefined;

  const targetNodeIds = asStrings(body.targetNodeIds);
  const targetNames = asStrings(body.targetNames);
  const artifactTypes = asStrings(body.requiredArtifactTypes);

  return {
    projectId,
    ...(typeof body.runId === 'string' ? { runId: body.runId } : {}),
    taskType: taskType as TaskType,
    ...(targetNodeIds ? { targetNodeIds } : {}),
    ...(targetNames ? { targetNames } : {}),
    ...(nodeTypes ? { requiredNodeTypes: nodeTypes as GraphNodeType[] } : {}),
    ...(artifactTypes ? { requiredArtifactTypes: artifactTypes as ArtifactType[] } : {}),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
    ...(typeof body.includeDependencies === 'boolean'
      ? { includeDependencies: body.includeDependencies }
      : {}),
    ...(typeof depth === 'number' ? { dependencyDepth: depth } : {}),
    ...(typeof body.includeDependents === 'boolean'
      ? { includeDependents: body.includeDependents }
      : {}),
    ...(typeof body.includeSourceFiles === 'boolean'
      ? { includeSourceFiles: body.includeSourceFiles }
      : {}),
    ...(mode ? { mode } : {}),
    ...(typeof body.instruction === 'string' ? { instruction: body.instruction } : {}),
  };
}

/** The compiled context, text included — what the model would actually receive. */
export async function inspectHandler(req: Request, res: Response): Promise<void> {
  const request = readRequest(req);
  const context = await buildContextWithFallback(ownerOf(req), request);
  sendSuccess(res, context);
}

/** The trace and the numbers, without the context body — cheap to poll. */
export async function traceHandler(req: Request, res: Response): Promise<void> {
  const request = readRequest(req);
  const context = await buildContext(ownerOf(req), request);
  sendSuccess(res, {
    taskType: context.taskType,
    mode: context.mode,
    tokens: context.tokens,
    tokensAreExact: context.tokensAreExact,
    tokenMethod: context.tokenMethod,
    budget: context.budget,
    sections: context.sections.map((section) => ({
      title: section.title,
      tokens: section.tokens,
      sourceArtifact: section.sourceArtifact,
    })),
    trace: context.trace,
  });
}

export async function benchmarkHandler(req: Request, res: Response): Promise<void> {
  const request = readRequest(req);
  const callModel = (req.body as { callModel?: unknown }).callModel === true;
  sendSuccess(res, await runBenchmark(ownerOf(req), request, { callModel }));
}

/** Engine health: tokenizer accuracy against real provider counts, cache size. */
export function statsHandler(_req: Request, res: Response): void {
  sendSuccess(res, { tokenAccuracy: tokenAccuracy(), contextCacheEntries: cacheSize() });
}
