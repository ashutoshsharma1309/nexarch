/**
 * Which slice of the graph is on screen.
 *
 * A generated project's graph runs to a few hundred nodes, and more than
 * half of those are leaves — every column of every table, every file, every
 * npm package. Drawing all of them at once produces a hairball that is
 * technically complete and practically useless.
 *
 * So the default view is the architectural spine: the nodes a person asks
 * "what did this build?" about. The other modes bring the detail back in
 * when it is the thing being looked at. This is presentation only — the
 * relationships all come from the server, and no mode invents an edge.
 */
import type { EngGraphEdge, EngGraphNode, EngNodeType } from '@/shared/types/api';

export type ViewModeId =
  'architecture' | 'dependencies' | 'services' | 'database' | 'apis' | 'files' | 'security' | 'all';

export interface ViewMode {
  id: ViewModeId;
  label: string;
  description: string;
  /** Types this mode shows. Empty means every type. */
  types: EngNodeType[];
}

export const VIEW_MODES: readonly ViewMode[] = [
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'The spine: what was asked for, what was planned, and what serves it.',
    types: ['PROJECT', 'REQUIREMENT', 'FEATURE', 'MODULE', 'SERVICE', 'API', 'ENTITY', 'COMPONENT'],
  },
  {
    id: 'dependencies',
    label: 'Dependencies',
    description: 'External packages the generated project pulls in.',
    types: ['PROJECT', 'MODULE', 'DEPENDENCY'],
  },
  {
    id: 'services',
    label: 'Services',
    description: 'Backend modules, their services, and the entities they persist.',
    types: ['MODULE', 'SERVICE', 'ENTITY', 'API'],
  },
  {
    id: 'database',
    label: 'Database',
    description: 'Entities and their columns, with the services that write them.',
    types: ['ENTITY', 'FIELD', 'SERVICE'],
  },
  {
    id: 'apis',
    label: 'APIs',
    description: 'Endpoints, the features exposing them, and the callers.',
    types: ['FEATURE', 'API', 'SERVICE', 'COMPONENT'],
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Generated source and tests, by the module that produced them.',
    types: ['MODULE', 'COMPONENT', 'FILE', 'TEST'],
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Findings and access rules, against what they govern.',
    types: ['SECURITY_RULE', 'ENTITY', 'API', 'PROJECT'],
  },
  { id: 'all', label: 'Everything', description: 'Every node in the graph.', types: [] },
];

/** The architecture view is the fallback — it is always first in the list. */
const DEFAULT_MODE: ViewMode = {
  id: 'architecture',
  label: 'Architecture',
  description: 'The spine: what was asked for, what was planned, and what serves it.',
  types: ['PROJECT', 'REQUIREMENT', 'FEATURE', 'MODULE', 'SERVICE', 'API', 'ENTITY', 'COMPONENT'],
};

export function viewMode(id: ViewModeId): ViewMode {
  return VIEW_MODES.find((mode) => mode.id === id) ?? DEFAULT_MODE;
}

export interface VisibleGraph {
  nodes: EngGraphNode[];
  edges: EngGraphEdge[];
  /** Nodes the current mode and filters excluded — reported, not hidden silently. */
  hiddenCount: number;
}

/**
 * Applies the mode, an optional type filter and an optional search to the
 * loaded graph.
 *
 * Edges survive only when both endpoints do. A half-connected edge would
 * render as a line into empty space, which reads as a bug rather than as a
 * filtered view.
 */
export function applyView(
  nodes: EngGraphNode[],
  edges: EngGraphEdge[],
  options: { mode: ViewModeId; types?: EngNodeType[]; search?: string },
): VisibleGraph {
  const mode = viewMode(options.mode);
  const allowed = options.types?.length
    ? new Set(options.types)
    : mode.types.length
      ? new Set(mode.types)
      : null;

  const needle = options.search?.trim().toLowerCase() ?? '';

  let visible = nodes.filter((node) => !allowed || allowed.has(node.type));

  if (needle !== '') {
    // A search keeps matches *and* their immediate neighbours, so a hit is
    // never a lone dot with no context.
    const matched = new Set(
      visible
        .filter(
          (node) =>
            node.name.toLowerCase().includes(needle) ||
            node.type.toLowerCase().includes(needle) ||
            node.canonicalName.toLowerCase().includes(needle),
        )
        .map((node) => node.id),
    );
    const keep = new Set(matched);
    for (const edge of edges) {
      if (matched.has(edge.sourceNodeId)) keep.add(edge.targetNodeId);
      if (matched.has(edge.targetNodeId)) keep.add(edge.sourceNodeId);
    }
    visible = visible.filter((node) => keep.has(node.id));
  }

  const visibleIds = new Set(visible.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId),
  );

  return { nodes: visible, edges: visibleEdges, hiddenCount: nodes.length - visible.length };
}

/** Direct neighbours of a node, for the highlight-on-select behaviour. */
export function neighboursOf(
  edges: EngGraphEdge[],
  nodeId: string,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>([nodeId]);
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceNodeId === nodeId) {
      nodeIds.add(edge.targetNodeId);
      edgeIds.add(edge.id);
    } else if (edge.targetNodeId === nodeId) {
      nodeIds.add(edge.sourceNodeId);
      edgeIds.add(edge.id);
    }
  }
  return { nodeIds, edgeIds };
}
