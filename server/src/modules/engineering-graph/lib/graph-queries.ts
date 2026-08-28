/**
 * Traversal over a loaded graph.
 *
 * Every function here takes nodes and edges as arguments rather than
 * reading the database itself. That is deliberate: a request that answers
 * three questions about one project loads the graph once and asks three
 * times, instead of issuing three sets of queries. At a few hundred nodes
 * per project the whole graph is smaller than a single artifact, so the
 * cheapest index is an adjacency map built once in memory.
 *
 * Traversal is breadth-first and depth-bounded. The bound is not a
 * performance guard so much as a relevance one: everything in a project is
 * reachable from everything else if you walk far enough, so an unbounded
 * "what depends on this" answers "all of it" and helps nobody.
 */
import type {
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphPath,
  GraphRelationship,
  NodeNeighbourhood,
  RelatedNode,
  TraversalDirection,
  TraversalOptions,
} from '../../../shared/contracts/index.js';

export interface GraphIndex {
  nodesById: Map<string, GraphNode>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Builds the adjacency map every traversal below walks. */
export function indexGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphIndex {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const out = outgoing.get(edge.sourceNodeId);
    if (out) out.push(edge);
    else outgoing.set(edge.sourceNodeId, [edge]);

    const inc = incoming.get(edge.targetNodeId);
    if (inc) inc.push(edge);
    else incoming.set(edge.targetNodeId, [edge]);
  }

  return { nodesById, outgoing, incoming, nodes, edges };
}

const DEFAULT_DEPTH = 3;
const DEFAULT_LIMIT = 200;

/** Edges leaving or entering a node, according to direction. */
function edgesFrom(index: GraphIndex, nodeId: string, direction: TraversalDirection): GraphEdge[] {
  if (direction === 'outgoing') return index.outgoing.get(nodeId) ?? [];
  if (direction === 'incoming') return index.incoming.get(nodeId) ?? [];
  return [...(index.outgoing.get(nodeId) ?? []), ...(index.incoming.get(nodeId) ?? [])];
}

function otherEnd(edge: GraphEdge, from: string): string {
  return edge.sourceNodeId === from ? edge.targetNodeId : edge.sourceNodeId;
}

/**
 * Breadth-first walk from one node.
 *
 * Visited-tracking is by node id and happens on enqueue, so a node reached
 * by two paths is reported once, at the shorter depth — which is the depth
 * that matters when the number is being read as "how closely related".
 */
export function traverse(
  index: GraphIndex,
  startId: string,
  direction: TraversalDirection,
  options: TraversalOptions = {},
): RelatedNode[] {
  const maxDepth = options.maxDepth ?? DEFAULT_DEPTH;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const allowedRelationships = options.relationships ? new Set(options.relationships) : null;
  const allowedTypes = options.nodeTypes ? new Set(options.nodeTypes) : null;

  const visited = new Set<string>([startId]);
  const results: RelatedNode[] = [];
  let frontier: { id: string; via: GraphRelationship }[] = [{ id: startId, via: 'CONTAINS' }];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: { id: string; via: GraphRelationship }[] = [];

    for (const current of frontier) {
      for (const edge of edgesFrom(index, current.id, direction)) {
        if (allowedRelationships && !allowedRelationships.has(edge.relationship)) continue;

        const neighbourId = otherEnd(edge, current.id);
        if (visited.has(neighbourId)) continue;
        visited.add(neighbourId);

        const node = index.nodesById.get(neighbourId);
        if (!node) continue;

        next.push({ id: neighbourId, via: edge.relationship });
        if (allowedTypes && !allowedTypes.has(node.type)) continue;

        results.push({ node, depth, via: edge.relationship });
        if (results.length >= limit) return results;
      }
    }
    frontier = next;
  }

  return results;
}

/** What this node needs: one hop out. */
export function dependenciesOf(
  index: GraphIndex,
  nodeId: string,
  options: TraversalOptions = {},
): RelatedNode[] {
  return traverse(index, nodeId, 'outgoing', { maxDepth: 1, ...options });
}

/** What needs this node: one hop in. */
export function dependentsOf(
  index: GraphIndex,
  nodeId: string,
  options: TraversalOptions = {},
): RelatedNode[] {
  return traverse(index, nodeId, 'incoming', { maxDepth: 1, ...options });
}

/** Nodes this one CONTAINS. */
export function childrenOf(index: GraphIndex, nodeId: string): RelatedNode[] {
  return traverse(index, nodeId, 'outgoing', { maxDepth: 1, relationships: ['CONTAINS'] });
}

/** Nodes that CONTAIN this one. */
export function parentsOf(index: GraphIndex, nodeId: string): RelatedNode[] {
  return traverse(index, nodeId, 'incoming', { maxDepth: 1, relationships: ['CONTAINS'] });
}

/** Everything one hop away in either direction, with the edges themselves. */
export function neighbourhoodOf(index: GraphIndex, nodeId: string): NodeNeighbourhood | null {
  const node = index.nodesById.get(nodeId);
  if (!node) return null;

  const resolve = (edges: GraphEdge[], pick: (edge: GraphEdge) => string) =>
    edges
      .map((edge) => ({ edge, node: index.nodesById.get(pick(edge)) }))
      .filter((entry): entry is { edge: GraphEdge; node: GraphNode } => Boolean(entry.node));

  return {
    node,
    outgoing: resolve(index.outgoing.get(nodeId) ?? [], (edge) => edge.targetNodeId),
    incoming: resolve(index.incoming.get(nodeId) ?? [], (edge) => edge.sourceNodeId),
  };
}

export function nodesByType(index: GraphIndex, type: GraphNodeType): GraphNode[] {
  return index.nodes.filter((node) => node.type === type);
}

/**
 * The shortest directed chain between two nodes, e.g.
 * Component → API → Service → Entity.
 *
 * Breadth-first, so the first path found is the shortest. Returns null
 * rather than an empty path when the target is unreachable — "no path"
 * and "a path of length zero" are different answers.
 */
export function findPath(
  index: GraphIndex,
  fromId: string,
  toId: string,
  maxDepth = 6,
): GraphPath | null {
  if (fromId === toId) {
    const node = index.nodesById.get(fromId);
    return node ? { nodes: [node], relationships: [] } : null;
  }

  const visited = new Set<string>([fromId]);
  let frontier: { id: string; nodes: string[]; relationships: GraphRelationship[] }[] = [
    { id: fromId, nodes: [fromId], relationships: [] },
  ];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: typeof frontier = [];

    for (const current of frontier) {
      for (const edge of index.outgoing.get(current.id) ?? []) {
        const neighbourId = edge.targetNodeId;
        const path = {
          id: neighbourId,
          nodes: [...current.nodes, neighbourId],
          relationships: [...current.relationships, edge.relationship],
        };

        if (neighbourId === toId) {
          const nodes = path.nodes
            .map((id) => index.nodesById.get(id))
            .filter((node): node is GraphNode => Boolean(node));
          return { nodes, relationships: path.relationships };
        }
        if (visited.has(neighbourId)) continue;
        visited.add(neighbourId);
        next.push(path);
      }
    }
    frontier = next;
  }

  return null;
}
