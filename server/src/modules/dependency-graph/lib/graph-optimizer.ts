/**
 * Graph algorithms shared by the statistics and quality reports: cycle
 * detection (DFS with a recursion-stack guard), orphan detection (fully
 * disconnected nodes), multi-source BFS depth from every node with no
 * incoming edge, and content-identical duplicate detection for components
 * and services.
 */
import type {
  CircularDependency,
  DuplicateGroup,
  EdgeType,
  GraphEdge,
  GraphNode,
} from '../dependency-graph.types.js';
import type { ScannedFile } from './project-scanner.js';

interface AdjacencyMaps {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

/**
 * `authenticates`/`authorizes`/`validates`/`reads-config` describe a
 * cross-cutting concern applied *at* a node (e.g. "jwt.ts guards this
 * route"), not a static code dependency between two files. Mixed into the
 * same graph as `imports`/`invokes`/`queries`, they create false-positive
 * cycles: jwt.ts "authenticates" the logout endpoint, whose controller
 * "invokes" a service that legitimately `imports` jwt.ts — a real code
 * shape, not a circular dependency. Structural analysis (cycles, depth,
 * orphans) excludes these edge types; impact analysis still uses the full
 * graph, because "if jwt.ts changes, re-check every route it guards" is
 * exactly the relationship that edge type exists to answer.
 */
const NON_STRUCTURAL_EDGE_TYPES = new Set<EdgeType>([
  'authenticates',
  'authorizes',
  'validates',
  'reads-config',
]);

export function structuralEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => !NON_STRUCTURAL_EDGE_TYPES.has(e.type));
}

export function buildAdjacency(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): AdjacencyMaps {
  const outgoing = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const incoming = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }
  return { outgoing, incoming };
}

export function detectCycles(
  nodes: readonly GraphNode[],
  adjacency: AdjacencyMaps,
): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const seenCycles = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];

  function visit(id: string): void {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      const startIndex = path.indexOf(id);
      const cycle = path.slice(startIndex);
      const key = [...cycle].sort().join('|');
      if (!seenCycles.has(key) && cycle.length > 0) {
        seenCycles.add(key);
        cycles.push({ cycle: [...cycle, id], length: cycle.length });
      }
      return;
    }

    state.set(id, 'visiting');
    path.push(id);
    for (const next of adjacency.outgoing.get(id) ?? []) visit(next);
    path.pop();
    state.set(id, 'done');
  }

  for (const node of nodes) visit(node.id);
  return cycles;
}

export function findOrphanNodes(nodes: readonly GraphNode[], adjacency: AdjacencyMaps): string[] {
  return nodes
    .filter(
      (n) =>
        (adjacency.incoming.get(n.id)?.length ?? 0) === 0 &&
        (adjacency.outgoing.get(n.id)?.length ?? 0) === 0,
    )
    .map((n) => n.id);
}

const ENTRY_POINT_SUFFIXES = ['/app.ts', '/index.ts', '/main.tsx', '/router.tsx'];

function isEntryPoint(file: string | null): boolean {
  if (!file) return false;
  return (
    file === 'src/app.ts' ||
    file === 'src/index.ts' ||
    file === 'src/main.tsx' ||
    file === 'src/app/router.tsx' ||
    file === 'src/app/App.tsx' ||
    ENTRY_POINT_SUFFIXES.some((suffix) => file.endsWith(suffix))
  );
}

/** Files nothing else references, excluding legitimate entry points. */
export function findUnreferencedNodes(
  nodes: readonly GraphNode[],
  adjacency: AdjacencyMaps,
): string[] {
  return nodes
    .filter(
      (n) =>
        n.file !== null &&
        !isEntryPoint(n.file) &&
        (adjacency.incoming.get(n.id)?.length ?? 0) === 0,
    )
    .map((n) => n.id);
}

export function computeDepth(
  nodes: readonly GraphNode[],
  adjacency: AdjacencyMaps,
): { average: number; max: number } {
  const sources = nodes
    .filter((n) => (adjacency.incoming.get(n.id)?.length ?? 0) === 0)
    .map((n) => n.id);
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const source of sources) {
    depth.set(source, 0);
    queue.push(source);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) continue;
    const currentDepth = depth.get(current) ?? 0;
    for (const next of adjacency.outgoing.get(current) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, currentDepth + 1);
      queue.push(next);
    }
  }

  const values = [...depth.values()];
  if (values.length === 0) return { average: 0, max: 0 };
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  const max = Math.max(...values);
  return { average: Math.round(average * 100) / 100, max };
}

export function findDuplicateContent(files: readonly ScannedFile[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const kind of ['component', 'service'] as const) {
    const byContent = new Map<string, ScannedFile[]>();
    for (const file of files) {
      if (file.kind !== kind) continue;
      const list = byContent.get(file.content) ?? [];
      list.push(file);
      byContent.set(file.content, list);
    }
    for (const list of byContent.values()) {
      if (list.length < 2) continue;
      groups.push({
        kind,
        label: list[0]?.label ?? kind,
        nodeIds: list.map((f) => `file:${f.path}`),
      });
    }
  }
  return groups;
}
