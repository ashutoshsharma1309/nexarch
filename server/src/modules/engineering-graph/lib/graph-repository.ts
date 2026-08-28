/**
 * Reading and synchronizing the stored graph.
 *
 * Synchronization is a diff, not a rebuild. Deleting a project's nodes and
 * re-inserting them would be simpler to write and wrong in two ways: node
 * ids would change on every run, breaking anything that stored a reference
 * to one, and a transient builder failure would leave the project with no
 * graph at all rather than a slightly stale one.
 *
 * So `syncGraph` computes what the draft says should exist, compares it to
 * what is stored, and applies the difference — creating what is new,
 * refreshing what changed, removing what the project no longer contains.
 * Re-running it with unchanged artifacts is a no-op, which is what makes
 * it safe to call on every pipeline run.
 */
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { nodeKey } from './canonical.js';
import type {
  ArtifactType,
  GraphDraft,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelationship,
  GraphStats,
  GraphSyncResult,
} from '../../../shared/contracts/index.js';

interface NodeRow {
  id: string;
  projectId: string;
  runId: string;
  type: GraphNodeType;
  canonicalName: string;
  name: string;
  description: string | null;
  metadata: unknown;
  sourceArtifactId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EdgeRow {
  id: string;
  projectId: string;
  runId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: GraphRelationship;
  metadata: unknown;
  createdAt: Date;
}

/**
 * Metadata on its way *into* the database. Prisma types JSON columns as
 * `InputJsonValue`, which `Record<string, unknown>` is not assignable to —
 * so the conversion happens once, here, rather than as a cast at each of
 * the three write sites.
 */
function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    projectId: row.projectId,
    runId: row.runId,
    type: row.type,
    canonicalName: row.canonicalName,
    name: row.name,
    description: row.description,
    metadata: asMetadata(row.metadata),
    sourceArtifactId: (row.sourceArtifactId as ArtifactType | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    projectId: row.projectId,
    runId: row.runId,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    relationship: row.relationship,
    metadata: asMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── In-memory backend (no DATABASE_URL) ──────────────────────────────── */

const memNodes = new Map<string, NodeRow>();
const memEdges = new Map<string, EdgeRow>();
const useMemory = (): boolean => !config.database.enabled;

function memNodesOf(projectId: string): NodeRow[] {
  return [...memNodes.values()].filter((row) => row.projectId === projectId);
}
function memEdgesOf(projectId: string): EdgeRow[] {
  return [...memEdges.values()].filter((row) => row.projectId === projectId);
}

/**
 * In-memory equivalent of syncGraph. Node ids stay stable across runs by
 * reusing the id of an existing (type, canonicalName), so references survive
 * a re-sync just as they do on the database path.
 */
function memSyncGraph(projectId: string, runId: string, draft: GraphDraft): GraphSyncResult {
  const startedAt = Date.now();
  const now = new Date();
  const existingNodes = memNodesOf(projectId);
  const existingNodeById = new Map(existingNodes.map((row) => [row.id, row]));
  const existingIdByKey = new Map(
    existingNodes.map((row) => [nodeKey(row.type, row.canonicalName), row.id]),
  );

  let nodesCreated = 0;
  let nodesUpdated = 0;
  const nextIdByKey = new Map<string, string>();

  for (const node of draft.nodes) {
    const key = nodeKey(node.type, node.canonicalName);
    const existingId = existingIdByKey.get(key);
    const id = existingId ?? randomUUID();
    nextIdByKey.set(key, id);
    const prior = existingId ? existingNodeById.get(existingId) : undefined;
    memNodes.set(id, {
      id,
      projectId,
      runId,
      type: node.type,
      canonicalName: node.canonicalName,
      name: node.name,
      description: node.description ?? null,
      metadata: node.metadata ?? {},
      sourceArtifactId: node.sourceArtifactId,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    });
    if (prior) nodesUpdated += 1;
    else nodesCreated += 1;
  }

  // Remove nodes the project no longer contains, and their edges.
  const keptIds = new Set(nextIdByKey.values());
  let nodesRemoved = 0;
  for (const row of existingNodes) {
    if (!keptIds.has(row.id)) {
      memNodes.delete(row.id);
      nodesRemoved += 1;
    }
  }

  const edgeKey = (source: string, target: string, relationship: string): string =>
    `${source}|${relationship}|${target}`;
  const existingEdges = memEdgesOf(projectId);
  const existingEdgeIdByKey = new Map(
    existingEdges.map((row) => [
      edgeKey(row.sourceNodeId, row.targetNodeId, row.relationship),
      row.id,
    ]),
  );

  const wanted = new Map<
    string,
    {
      source: string;
      target: string;
      relationship: GraphRelationship;
      metadata: Record<string, unknown>;
    }
  >();
  for (const edge of draft.edges) {
    const source = nextIdByKey.get(nodeKey(edge.from.type, edge.from.canonicalName));
    const target = nextIdByKey.get(nodeKey(edge.to.type, edge.to.canonicalName));
    if (!source || !target) continue;
    wanted.set(edgeKey(source, target, edge.relationship), {
      source,
      target,
      relationship: edge.relationship,
      metadata: edge.metadata ?? {},
    });
  }

  let edgesCreated = 0;
  for (const [key, edge] of wanted) {
    if (existingEdgeIdByKey.has(key)) continue;
    const id = randomUUID();
    memEdges.set(id, {
      id,
      projectId,
      runId,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      relationship: edge.relationship,
      metadata: edge.metadata,
      createdAt: now,
    });
    edgesCreated += 1;
  }

  let edgesRemoved = 0;
  for (const [key, id] of existingEdgeIdByKey) {
    if (!wanted.has(key)) {
      memEdges.delete(id);
      edgesRemoved += 1;
    }
  }

  return {
    nodesCreated,
    nodesUpdated,
    nodesRemoved,
    edgesCreated,
    edgesRemoved,
    nodeCount: memNodesOf(projectId).length,
    edgeCount: memEdgesOf(projectId).length,
    durationMs: Date.now() - startedAt,
  };
}

/** Cheap equality check — avoids an UPDATE for a node nothing changed about. */
function nodeUnchanged(row: NodeRow, draft: GraphDraft['nodes'][number]): boolean {
  return (
    row.name === draft.name &&
    row.description === (draft.description ?? null) &&
    row.sourceArtifactId === draft.sourceArtifactId &&
    JSON.stringify(asMetadata(row.metadata)) === JSON.stringify(draft.metadata ?? {})
  );
}

/**
 * Makes the stored graph match the draft.
 *
 * Node identity is `(projectId, type, canonicalName)`, which the database
 * enforces with a unique index — so deduplication is not a pass this code
 * performs, it is a property the schema guarantees.
 */
export async function syncGraph(
  projectId: string,
  runId: string,
  draft: GraphDraft,
): Promise<GraphSyncResult> {
  if (useMemory()) return memSyncGraph(projectId, runId, draft);
  const startedAt = Date.now();

  const existingNodes = (await prisma.graphNode.findMany({ where: { projectId } })) as NodeRow[];
  const existingByKey = new Map(
    existingNodes.map((row) => [nodeKey(row.type, row.canonicalName), row]),
  );
  const draftByKey = new Map(
    draft.nodes.map((node) => [nodeKey(node.type, node.canonicalName), node]),
  );

  let nodesCreated = 0;
  let nodesUpdated = 0;

  // Upsert every drafted node.
  for (const [key, node] of draftByKey) {
    const existing = existingByKey.get(key);
    if (!existing) {
      await prisma.graphNode.create({
        data: {
          projectId,
          runId,
          type: node.type,
          canonicalName: node.canonicalName,
          name: node.name,
          description: node.description ?? null,
          metadata: toJson(node.metadata),
          sourceArtifactId: node.sourceArtifactId,
        },
      });
      nodesCreated += 1;
      continue;
    }
    if (nodeUnchanged(existing, node) && existing.runId === runId) continue;
    await prisma.graphNode.update({
      where: { id: existing.id },
      data: {
        runId,
        name: node.name,
        description: node.description ?? null,
        metadata: toJson(node.metadata),
        sourceArtifactId: node.sourceArtifactId,
      },
    });
    nodesUpdated += 1;
  }

  // Anything the project no longer contains goes. Cascading deletes take
  // that node's edges with it, which is why edge cleanup runs after.
  const obsoleteNodeIds = existingNodes
    .filter((row) => !draftByKey.has(nodeKey(row.type, row.canonicalName)))
    .map((row) => row.id);
  if (obsoleteNodeIds.length > 0) {
    await prisma.graphNode.deleteMany({ where: { id: { in: obsoleteNodeIds } } });
  }

  // Re-read so every drafted node has a real id to hang edges from.
  const currentNodes = (await prisma.graphNode.findMany({ where: { projectId } })) as NodeRow[];
  const idByKey = new Map(
    currentNodes.map((row) => [nodeKey(row.type, row.canonicalName), row.id]),
  );

  const existingEdges = (await prisma.graphEdge.findMany({ where: { projectId } })) as EdgeRow[];
  const edgeKey = (source: string, target: string, relationship: string): string =>
    `${source}|${relationship}|${target}`;
  const existingEdgeKeys = new Map(
    existingEdges.map((row) => [
      edgeKey(row.sourceNodeId, row.targetNodeId, row.relationship),
      row.id,
    ]),
  );

  const wanted = new Map<
    string,
    {
      source: string;
      target: string;
      relationship: GraphRelationship;
      metadata: Record<string, unknown>;
    }
  >();
  for (const edge of draft.edges) {
    const source = idByKey.get(nodeKey(edge.from.type, edge.from.canonicalName));
    const target = idByKey.get(nodeKey(edge.to.type, edge.to.canonicalName));
    // An edge whose endpoint is missing is silently dropped rather than
    // written as a dangling row — validation reports on shape, it should
    // not have to clean up after the writer.
    if (!source || !target) continue;
    wanted.set(edgeKey(source, target, edge.relationship), {
      source,
      target,
      relationship: edge.relationship,
      metadata: edge.metadata ?? {},
    });
  }

  let edgesCreated = 0;
  const toCreate = [...wanted.entries()].filter(([key]) => !existingEdgeKeys.has(key));
  if (toCreate.length > 0) {
    await prisma.graphEdge.createMany({
      data: toCreate.map(([, edge]) => ({
        projectId,
        runId,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        relationship: edge.relationship,
        metadata: toJson(edge.metadata),
      })),
      skipDuplicates: true,
    });
    edgesCreated = toCreate.length;
  }

  const obsoleteEdgeIds = [...existingEdgeKeys.entries()]
    .filter(([key]) => !wanted.has(key))
    .map(([, id]) => id);
  if (obsoleteEdgeIds.length > 0) {
    await prisma.graphEdge.deleteMany({ where: { id: { in: obsoleteEdgeIds } } });
  }

  const [nodeCount, edgeCount] = await Promise.all([
    prisma.graphNode.count({ where: { projectId } }),
    prisma.graphEdge.count({ where: { projectId } }),
  ]);

  return {
    nodesCreated,
    nodesUpdated,
    nodesRemoved: obsoleteNodeIds.length,
    edgesCreated,
    edgesRemoved: obsoleteEdgeIds.length,
    nodeCount,
    edgeCount,
    durationMs: Date.now() - startedAt,
  };
}

/* ── Reads ────────────────────────────────────────────────────────────── */

export async function loadNodes(projectId: string, type?: GraphNodeType): Promise<GraphNode[]> {
  if (useMemory()) {
    return memNodesOf(projectId)
      .filter((row) => (type ? row.type === type : true))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map(toNode);
  }
  const rows = (await prisma.graphNode.findMany({
    where: { projectId, ...(type ? { type } : {}) },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })) as NodeRow[];
  return rows.map(toNode);
}

export async function loadEdges(projectId: string): Promise<GraphEdge[]> {
  if (useMemory()) return memEdgesOf(projectId).map(toEdge);
  const rows = (await prisma.graphEdge.findMany({ where: { projectId } })) as EdgeRow[];
  return rows.map(toEdge);
}

export async function loadNode(projectId: string, nodeId: string): Promise<GraphNode | null> {
  if (useMemory()) {
    const row = memNodes.get(nodeId);
    if (!row) return null;
    if (row.projectId !== projectId) return null;
    return toNode(row);
  }
  // Project id is in the filter, not checked afterwards: another project's
  // node is never loaded in the first place.
  const row = (await prisma.graphNode.findFirst({
    where: { id: nodeId, projectId },
  })) as NodeRow | null;
  return row ? toNode(row) : null;
}

export async function countNodes(projectId: string): Promise<number> {
  if (useMemory()) return memNodesOf(projectId).length;
  return prisma.graphNode.count({ where: { projectId } });
}

export function computeStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const nodesByType: Partial<Record<GraphNodeType, number>> = {};
  for (const node of nodes) nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;

  const edgesByRelationship: Partial<Record<GraphRelationship, number>> = {};
  for (const edge of edges) {
    edgesByRelationship[edge.relationship] = (edgesByRelationship[edge.relationship] ?? 0) + 1;
  }

  return { nodeCount: nodes.length, edgeCount: edges.length, nodesByType, edgesByRelationship };
}
