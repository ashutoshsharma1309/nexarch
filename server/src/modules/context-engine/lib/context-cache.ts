/**
 * Compiled contexts, keyed on everything that can change them.
 *
 * The key includes the run id, because a new run means new artifacts and a
 * new graph — reusing a context across runs is exactly the "stale
 * engineering context" failure this cache must not have. Anything that
 * would alter the selection (task, targets, depth, budget, mode) is in the
 * key too, so a cache hit is only ever a request that would have produced
 * an identical result.
 *
 * Entries are process-local and bounded, matching every other cache in
 * this platform.
 */
import { createHash } from 'node:crypto';

import type { CompiledContext, ContextRequest } from '../context-engine.types.js';

interface Entry {
  context: CompiledContext;
  storedAt: number;
}

const MAX_ENTRIES = 60;
const TTL_MS = 10 * 60 * 1000;

const entries = new Map<string, Entry>();

export function cacheKey(request: ContextRequest, graphVersion: string): string {
  const shape = JSON.stringify({
    p: request.projectId,
    r: request.runId ?? null,
    t: request.taskType,
    ids: [...(request.targetNodeIds ?? [])].sort(),
    names: [...(request.targetNames ?? [])].map((n) => n.toLowerCase()).sort(),
    types: [...(request.requiredNodeTypes ?? [])].sort(),
    arts: [...(request.requiredArtifactTypes ?? [])].sort(),
    max: request.maxTokens ?? null,
    deps: request.includeDependencies ?? true,
    depth: request.dependencyDepth ?? null,
    dependents: request.includeDependents ?? false,
    files: request.includeSourceFiles ?? false,
    mode: request.mode ?? 'SELECTIVE',
    instruction: request.instruction ?? null,
    // Changes whenever the project's graph changes.
    g: graphVersion,
  });
  return createHash('sha256').update(shape).digest('hex').slice(0, 32);
}

export function readCache(key: string): CompiledContext | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) {
    entries.delete(key);
    return null;
  }
  return entry.context;
}

export function writeCache(key: string, context: CompiledContext): void {
  entries.set(key, { context, storedAt: Date.now() });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Drops every cached context for one project — called when its graph changes. */
export function invalidateProject(projectId: string): number {
  let removed = 0;
  for (const [key, entry] of entries) {
    if (entry.context.projectId === projectId) {
      entries.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function resetCacheForTests(): void {
  entries.clear();
}

export function cacheSize(): number {
  return entries.size;
}
