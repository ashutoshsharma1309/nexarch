/**
 * Versioned, traceable artifacts.
 *
 * Phase 6 kept a flat map of artifact type → latest value, which is all
 * the scheduler needs to decide what is READY. The planning mesh needs
 * more than that: an architecture regenerated after a requirement change
 * is a *second* architecture, and overwriting the first destroys the
 * record of what the earlier decision was and what it was based on.
 *
 * So every write is a new version, and every version records which
 * artifacts it was derived from. That is what lets a future UI answer the
 * question this whole layer exists for — *why did NexArch decide this?* —
 * by walking backwards from a decision to the inputs that produced it.
 *
 * Storage is process-local and bounded, matching the artifacts themselves.
 */
import { randomUUID } from 'node:crypto';

import type { AgentId, ArtifactType } from '../../../shared/contracts/index.js';

export interface ArtifactRecord {
  id: string;
  projectId: string;
  runId: string;
  type: ArtifactType;
  /** Monotonic per (project, type). v1, v2, … */
  version: number;
  /** The agent that produced it. */
  agentId: AgentId;
  /** Agent version, so a behaviour change is visible in the record. */
  agentVersion: string;
  /** Artifact ids this was derived from — the traceability edge. */
  derivedFrom: string[];
  content: unknown;
  createdAt: string;
}

/** Versions are counted per project so a rebuild continues the sequence. */
const versionCounters = new Map<string, number>();
const records = new Map<string, ArtifactRecord[]>();

const MAX_PROJECTS = 40;
const MAX_VERSIONS_PER_TYPE = 5;

function key(projectId: string, type: ArtifactType): string {
  return `${projectId}::${type}`;
}

export interface WriteInput {
  projectId: string;
  runId: string;
  type: ArtifactType;
  agentId: AgentId;
  agentVersion: string;
  derivedFrom: string[];
  content: unknown;
}

export function writeArtifact(input: WriteInput): ArtifactRecord {
  const counterKey = key(input.projectId, input.type);
  const version = (versionCounters.get(counterKey) ?? 0) + 1;
  versionCounters.set(counterKey, version);

  const record: ArtifactRecord = {
    id: randomUUID(),
    projectId: input.projectId,
    runId: input.runId,
    type: input.type,
    version,
    agentId: input.agentId,
    agentVersion: input.agentVersion,
    derivedFrom: input.derivedFrom,
    content: input.content,
    createdAt: new Date().toISOString(),
  };

  const history = records.get(counterKey) ?? [];
  history.push(record);
  // Keep a short history rather than one value: enough to answer "what
  // changed", bounded so a long-lived project cannot grow without limit.
  while (history.length > MAX_VERSIONS_PER_TYPE) history.shift();
  records.set(counterKey, history);

  while (records.size > MAX_PROJECTS * 10) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }

  return record;
}

/** The current version of one artifact type for a project. */
export function latestArtifact(projectId: string, type: ArtifactType): ArtifactRecord | undefined {
  return records.get(key(projectId, type))?.at(-1);
}

export function artifactHistory(projectId: string, type: ArtifactType): ArtifactRecord[] {
  return [...(records.get(key(projectId, type)) ?? [])];
}

/** Every artifact type this project currently holds, latest version each. */
export function latestArtifacts(projectId: string): ArtifactRecord[] {
  return [...records.entries()]
    .filter(([entryKey]) => entryKey.startsWith(`${projectId}::`))
    .map(([, history]) => history.at(-1))
    .filter((record): record is ArtifactRecord => Boolean(record));
}

/**
 * The provenance chain behind one artifact, nearest first.
 *
 * Answers "what was this built from" by following `derivedFrom` backwards.
 * Cycles are impossible by construction — an artifact can only derive from
 * one written earlier — but the visited set guards against a malformed
 * record rather than trusting that.
 */
export function traceLineage(artifactId: string): ArtifactRecord[] {
  const byId = new Map<string, ArtifactRecord>();
  for (const history of records.values()) {
    for (const record of history) byId.set(record.id, record);
  }

  const lineage: ArtifactRecord[] = [];
  const visited = new Set<string>();
  const queue = [artifactId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);

    const record = byId.get(current);
    if (!record) continue;
    if (current !== artifactId) lineage.push(record);
    queue.push(...record.derivedFrom);
  }

  return lineage;
}

export function resetArtifactStoreForTests(): void {
  records.clear();
  versionCounters.clear();
}
