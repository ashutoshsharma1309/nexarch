/**
 * In-memory generation run log — one record per pipeline run against a
 * project (Project-level "Track Generation History", not the AI
 * Orchestrator's per-prompt-call history at `/ai/history`). Same
 * in-memory/no-persistence-layer justification as `project-store.ts`.
 */
import type { CreateGenerationInput, GenerationRecord } from '../workspace.types.js';

const generations = new Map<string, GenerationRecord>();
let counter = 0;

function nextId(): string {
  counter += 1;
  return `gen_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function recordGeneration(input: CreateGenerationInput): GenerationRecord {
  const now = new Date().toISOString();
  const status = input.status ?? 'COMPLETED';
  const record: GenerationRecord = {
    id: nextId(),
    projectId: input.projectId,
    prompt: input.prompt,
    status,
    model: input.model ?? null,
    tokensUsed: input.tokensUsed ?? null,
    costUsd: input.costUsd ?? null,
    durationMs: input.durationMs ?? null,
    filesGenerated: input.filesGenerated ?? null,
    filesModified: input.filesModified ?? null,
    error: input.error ?? null,
    startedAt: now,
    completedAt: status === 'COMPLETED' || status === 'FAILED' ? now : null,
    createdAt: now,
  };
  generations.set(record.id, record);
  return record;
}

export function listGenerations(projectId?: string): GenerationRecord[] {
  // Map insertion order is chronological; reversing it (rather than sorting
  // by `createdAt`) keeps "most recent first" correct even when two records
  // are created within the same millisecond.
  let results = Array.from(generations.values()).reverse();
  if (projectId) {
    results = results.filter((g) => g.projectId === projectId);
  }
  return results;
}

export function deleteGenerationsForProject(projectId: string): void {
  for (const [id, record] of generations) {
    if (record.projectId === projectId) generations.delete(id);
  }
}

/** Test-only: reset state between test files. */
export function _resetGenerationLog(): void {
  generations.clear();
  counter = 0;
}
