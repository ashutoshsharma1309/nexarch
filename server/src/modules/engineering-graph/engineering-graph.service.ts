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
import { computeStats, loadEdges, loadNodes, syncGraph } from './lib/graph-repository.js';
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
import { lookupOverNodes, nodeByIdentity } from './lib/node-identity.js';
import { traceDirectionFor, traceRequirements } from './lib/requirement-trace.js';
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
  RequirementTrace,
  TraceDirection,
  TraversalOptions,
  TraversalResult,
} from '../../shared/contracts/engineering-graph.js';

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

/**
 * One node of this project, named either by its database id or by its
 * identity.
 *
 * The identity form is what makes a change-impact question answerable from a
 * file path. A node id only exists once the graph has been read, so every
 * caller that holds one path, canonical name or endpoint — the project
 * editor, the UI's trace view — had to fetch the whole graph and match it
 * client-side. `TYPE::canonical-name` or a bare name resolves here instead,
 * through the same code the builder uses, and a database id is tried first so
 * the existing shape of every route is unchanged.
 *
 * The graph is loaded once and the node found inside it, which is also what
 * scopes the lookup: `loadFor` resolves ownership and loads this project
 * only, so another project's id or identity simply is not in the index.
 */
async function loadForNode(
  ownerId: string,
  projectId: string,
  ref: string,
): Promise<{ index: GraphIndex; nodes: GraphNode[]; node: GraphNode }> {
  const { index, nodes } = await loadFor(ownerId, projectId);
  const node = index.nodesById.get(ref) ?? nodeByIdentity(lookupOverNodes(nodes), ref);
  if (!node) throw AppError.notFound('That graph node does not exist in this project');
  return { index, nodes, node };
}

/** The node a reference names, for a caller that wants the id itself. */
export async function lookupNode(
  ownerId: string,
  projectId: string,
  ref: string,
): Promise<GraphNode> {
  const { node } = await loadForNode(ownerId, projectId, ref);
  return node;
}

export async function getNode(
  ownerId: string,
  projectId: string,
  nodeId: string,
): Promise<NodeNeighbourhood> {
  const { index, node } = await loadForNode(ownerId, projectId, nodeId);
  const neighbourhood = neighbourhoodOf(index, node.id);
  if (!neighbourhood) throw AppError.notFound('That graph node does not exist in this project');
  return neighbourhood;
}

export async function getDependencies(
  ownerId: string,
  projectId: string,
  nodeId: string,
  options: TraversalOptions = {},
): Promise<TraversalResult> {
  const { index, node } = await loadForNode(ownerId, projectId, nodeId);
  return dependenciesOf(index, node.id, options);
}

export async function getDependents(
  ownerId: string,
  projectId: string,
  nodeId: string,
  options: TraversalOptions = {},
): Promise<TraversalResult> {
  const { index, node } = await loadForNode(ownerId, projectId, nodeId);
  return dependentsOf(index, node.id, options);
}

export async function getImpact(
  ownerId: string,
  projectId: string,
  nodeId: string,
  maxDepth = 3,
): Promise<ImpactAnalysis> {
  const { index, node } = await loadForNode(ownerId, projectId, nodeId);
  return analyzeImpact(index, node, maxDepth);
}

/**
 * Where a requirement ends up in the code, or which requirements a file
 * serves. One function for both, so the two readings cannot drift apart.
 */
export async function getTrace(
  ownerId: string,
  projectId: string,
  nodeId: string,
  direction?: TraceDirection,
): Promise<RequirementTrace> {
  const { index, node } = await loadForNode(ownerId, projectId, nodeId);
  return traceRequirements(index, node, direction ?? traceDirectionFor(node));
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
  const { index, nodes, node: from } = await loadForNode(ownerId, projectId, fromId);
  const to = index.nodesById.get(toId) ?? nodeByIdentity(lookupOverNodes(nodes), toId);
  if (!to) throw AppError.notFound('That graph node does not exist in this project');

  // Structural containers are refused as intermediate hops.
  //
  // Every node is CONTAINS-reachable from PROJECT, and files hang off
  // FOLDER, so an undirected search finds a route between almost any two
  // nodes by going up to the root and back down. Presented as "how this
  // requirement reaches that file", that route is a lie dressed as
  // evidence: it says the two are connected when all it found was that both
  // belong to the same project.
  //
  // They stay allowed as endpoints, so asking for a path *to* a folder
  // still works.
  const containers: GraphNodeType[] = ['PROJECT', 'FOLDER'];
  const excludeNodeTypes = containers.filter((type) => type !== from.type && type !== to.type);
  return findPath(index, from.id, to.id, 6, direction, { excludeNodeTypes });
}

/**
 * `latestRunId` is passed in rather than looked up: staleness is measured
 * against the project's latest completed *build*, which only the run store
 * knows, and the pipeline already imports this module — importing it back
 * would close the loop. The controller is the one place that may know both
 * (the same reasoning as `refreshHandler`). Without it the check is skipped
 * and the report says so.
 */
export async function validate(
  ownerId: string,
  projectId: string,
  latestRunId?: string,
): Promise<GraphValidationReport> {
  const { nodes, edges } = await loadFor(ownerId, projectId);
  return validateGraph(nodes, edges, latestRunId === undefined ? {} : { latestRunId });
}
