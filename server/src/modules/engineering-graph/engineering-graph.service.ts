/**
 * The Engineering Graph's public surface.
 *
 * Every read takes an `ownerId` and resolves the project through it before
 * touching a graph table. Ownership is therefore a precondition of loading
 * anything, not a check applied to results — a project belonging to
 * someone else fails at the first step with the same 404 a non-existent id
 * gets, so the API never confirms that another user's project exists.
 *
 * Reads load the project's nodes and edges once and index them in memory.
 * At the scale a generated project produces — a few hundred nodes — that
 * is cheaper than pushing traversal into SQL, and it means one request can
 * answer several questions without re-querying.
 */
import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import { invalidateProject } from '../context-engine/lib/context-cache.js';
import { buildGraph } from './lib/graph-builder.js';
import { computeStats, loadEdges, loadNode, loadNodes, syncGraph } from './lib/graph-repository.js';
import type { SyncScope } from './lib/graph-repository.js';
import {
  dependenciesOf,
  dependentsOf,
  findPath,
  indexGraph,
  neighbourhoodOf,
} from './lib/graph-queries.js';
import type { GraphIndex } from './lib/graph-queries.js';
import { analyzeImpact } from './lib/impact-analysis.js';
import { validateGraph } from './lib/graph-validator.js';
import type { PartialArtifacts } from './lib/graph-builder.js';
import type {
  EngineeringGraph,
  GraphNode,
  GraphNodeType,
  GraphPath,
  GraphSyncResult,
  GraphValidationReport,
  ImpactAnalysis,
  NodeNeighbourhood,
  PathDirection,
  RelatedNode,
  TraversalOptions,
} from '../../shared/contracts/index.js';

/**
 * Rebuilds this project's graph from a finished run's artifacts.
 *
 * Called by the pipeline, not by the user: a graph that has to be
 * refreshed by hand is a graph that is usually wrong.
 *
 * `coveredArtifacts` is how a caller that holds only part of a project —
 * the agent mesh mid-run — says so, so the sweep cannot delete the other
 * producer's nodes. A caller that omits it is treated as speaking only for
 * the artifacts its own draft produced nodes from. The rule is spelled out
 * at `syncGraph`.
 */
export async function synchronize(
  projectId: string,
  runId: string,
  artifacts: PartialArtifacts,
  coveredArtifacts?: SyncScope,
): Promise<GraphSyncResult> {
  const draft = buildGraph(artifacts);
  const result = await syncGraph(projectId, runId, draft, coveredArtifacts);
  // A changed graph invalidates every context compiled from the old one.
  // Serving stale engineering context is worse than recompiling it.
  const dropped = invalidateProject(projectId);
  logger.info('engineering graph synchronized', {
    projectId,
    runId,
    nodes: result.nodeCount,
    edges: result.edgeCount,
    created: result.nodesCreated,
    updated: result.nodesUpdated,
    removed: result.nodesRemoved,
    contextsInvalidated: dropped,
    durationMs: result.durationMs,
  });
  return result;
}

/** Loads a project's graph after confirming the caller owns it. */
async function loadFor(
  ownerId: string,
  projectId: string,
): Promise<{
  index: GraphIndex;
  nodes: GraphNode[];
  edges: Awaited<ReturnType<typeof loadEdges>>;
}> {
  await getProjectOrThrow(ownerId, projectId);
  const [nodes, edges] = await Promise.all([loadNodes(projectId), loadEdges(projectId)]);
  return { index: indexGraph(nodes, edges), nodes, edges };
}

export async function getGraph(
  ownerId: string,
  projectId: string,
  type?: GraphNodeType,
): Promise<EngineeringGraph> {
  const { nodes, edges } = await loadFor(ownerId, projectId);
  const filtered = type ? nodes.filter((node) => node.type === type) : nodes;
  const visible = new Set(filtered.map((node) => node.id));
  const relevantEdges = type
    ? edges.filter((edge) => visible.has(edge.sourceNodeId) && visible.has(edge.targetNodeId))
    : edges;

  /*
   * Freshness is read off the nodes, never off the clock.
   *
   * `generatedAt` used to be `new Date()`, which made a graph last analysed
   * weeks ago print as "analysed just now" — the one thing a map must not
   * lie about. The newest `updatedAt` is when the graph was last actually
   * written, and a graph with no nodes has no analysis time at all, so it
   * reports none rather than inventing one.
   *
   * `runId` is only reported when every loaded node agrees on it. Nodes are
   * refreshed per artifact, so a project can hold nodes from several runs;
   * naming the first node's run would present one of them as having
   * produced all of them. `runIds` says which runs are really in here.
   */
  const runIds = [...new Set(filtered.map((node) => node.runId))].sort();
  const analysedAt = filtered.reduce<string | null>(
    // Both sides are `toISOString()` output, so comparing them as strings
    // orders them as instants.
    (newest, node) => (newest === null || node.updatedAt > newest ? node.updatedAt : newest),
    null,
  );

  return {
    projectId,
    runId: runIds.length === 1 ? (runIds[0] ?? null) : null,
    runIds,
    nodes: filtered,
    edges: relevantEdges,
    stats: computeStats(filtered, relevantEdges),
    generatedAt: analysedAt,
  };
}

async function requireNode(ownerId: string, projectId: string, nodeId: string): Promise<GraphNode> {
  await getProjectOrThrow(ownerId, projectId);
  const node = await loadNode(projectId, nodeId);
  if (!node) throw AppError.notFound('That graph node does not exist in this project');
  return node;
}

export async function getNode(
  ownerId: string,
  projectId: string,
  nodeId: string,
): Promise<NodeNeighbourhood> {
  const node = await requireNode(ownerId, projectId, nodeId);
  const [nodes, edges] = await Promise.all([loadNodes(projectId), loadEdges(projectId)]);
  const neighbourhood = neighbourhoodOf(indexGraph(nodes, edges), node.id);
  if (!neighbourhood) throw AppError.notFound('That graph node does not exist in this project');
  return neighbourhood;
}

export async function getDependencies(
  ownerId: string,
  projectId: string,
  nodeId: string,
  options: TraversalOptions = {},
): Promise<RelatedNode[]> {
  const node = await requireNode(ownerId, projectId, nodeId);
  const { index } = await loadFor(ownerId, projectId);
  return dependenciesOf(index, node.id, options);
}

export async function getDependents(
  ownerId: string,
  projectId: string,
  nodeId: string,
  options: TraversalOptions = {},
): Promise<RelatedNode[]> {
  const node = await requireNode(ownerId, projectId, nodeId);
  const { index } = await loadFor(ownerId, projectId);
  return dependentsOf(index, node.id, options);
}

export async function getImpact(
  ownerId: string,
  projectId: string,
  nodeId: string,
  maxDepth = 3,
): Promise<ImpactAnalysis> {
  const node = await requireNode(ownerId, projectId, nodeId);
  const { index } = await loadFor(ownerId, projectId);
  return analyzeImpact(index, node, maxDepth);
}

export async function getPath(
  ownerId: string,
  projectId: string,
  fromId: string,
  toId: string,
  direction: PathDirection = 'outgoing',
): Promise<GraphPath | null> {
  // Both endpoints are resolved under this owner's project before anything is
  // traversed, so a node id from another project cannot be reached by asking
  // for a path to it.
  await requireNode(ownerId, projectId, fromId);
  await requireNode(ownerId, projectId, toId);
  const { index } = await loadFor(ownerId, projectId);
  return findPath(index, fromId, toId, 6, direction);
}

export async function validate(ownerId: string, projectId: string): Promise<GraphValidationReport> {
  const { nodes, edges } = await loadFor(ownerId, projectId);
  return validateGraph(nodes, edges);
}
