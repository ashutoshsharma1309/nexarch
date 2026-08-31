/**
 * Where nodes go.
 *
 * Three layouts, each answering a different question, and none of them
 * force-directed by default: a physics simulation on a *typed* graph
 * throws away the one thing that makes it readable — that requirements sit
 * above features, which sit above services, which sit above entities. Dagre
 * keeps that ordering.
 *
 *   hierarchical — top-down layers. "What is this project made of?"
 *   dependency   — left-to-right flow. "What does this reach?"
 *   radial       — concentric rings by type distance from the project root.
 *                  Cheap, deterministic, and good for spotting outliers.
 *
 * Layout runs on the *visible* subgraph, so switching a filter reflows only
 * what is on screen.
 */
import dagre from 'dagre';

import type { EngGraphEdge, EngGraphNode, EngNodeType } from '@/shared/types/api';

export type LayoutId = 'hierarchical' | 'dependency' | 'radial';

export const LAYOUTS: readonly { id: LayoutId; label: string; hint: string }[] = [
  { id: 'hierarchical', label: 'Hierarchy', hint: 'Layered top to bottom' },
  { id: 'dependency', label: 'Dependency', hint: 'Flow left to right' },
  { id: 'radial', label: 'Radial', hint: 'Rings by distance from the project' },
];

export const NODE_WIDTH = 172;
export const NODE_HEIGHT = 44;

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

/** Rank order for the radial layout: how far a type sits from the project root. */
const RING: Record<EngNodeType, number> = {
  PROJECT: 0,
  REQUIREMENT: 1,
  FEATURE: 2,
  MODULE: 3,
  COMPONENT: 3,
  SERVICE: 4,
  API: 4,
  ENTITY: 5,
  SECURITY_RULE: 5,
  FIELD: 6,
  FILE: 6,
  TEST: 6,
  DEPENDENCY: 6,
};

/**
 * Dagre puts every node of one rank in a single row. That is correct and
 * unusable: twenty-four endpoints share a rank, so the row runs several
 * thousand pixels wide and fit-to-view lands at a zoom where no label can
 * be read.
 *
 * So a wide rank is wrapped into several rows *within its own band*. The
 * layer ordering — the thing that makes a hierarchy worth drawing — is
 * untouched; only the packing inside a layer changes. The cap grows with
 * the graph so the result stays roughly square rather than a long strip.
 */
function wrapWideRanks(
  positioned: Positioned[],
  direction: 'TB' | 'LR',
  total: number,
): Positioned[] {
  const perRow = Math.max(6, Math.ceil(Math.sqrt(total * 1.6)));
  // Rank = shared coordinate on the cross axis.
  const rankKey = (p: Positioned): number => (direction === 'TB' ? p.y : p.x);

  const ranks = new Map<number, Positioned[]>();
  for (const point of positioned) {
    const key = Math.round(rankKey(point));
    const list = ranks.get(key);
    if (list) list.push(point);
    else ranks.set(key, [point]);
  }

  const wide = [...ranks.values()].some((members) => members.length > perRow);
  if (!wide) return positioned;

  const ordered = [...ranks.entries()].sort((a, b) => a[0] - b[0]);
  const gapAlong = direction === 'TB' ? NODE_WIDTH + 28 : NODE_HEIGHT + 22;
  const gapAcross = direction === 'TB' ? NODE_HEIGHT + 34 : NODE_WIDTH + 46;

  const result: Positioned[] = [];
  let cursor = 0;

  for (const [, members] of ordered) {
    members.sort((a, b) => (direction === 'TB' ? a.x - b.x : a.y - b.y));
    const rows = Math.ceil(members.length / perRow);

    for (const [index, point] of members.entries()) {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const inRow = Math.min(perRow, members.length - row * perRow);
      // Centre each row so wrapped ranks stay visually balanced.
      const offset = ((inRow - 1) * gapAlong) / -2;

      result.push(
        direction === 'TB'
          ? { id: point.id, x: offset + column * gapAlong, y: cursor + row * gapAcross }
          : { id: point.id, x: cursor + row * gapAcross, y: offset + column * gapAlong },
      );
    }
    cursor += rows * gapAcross + gapAcross * 0.6;
  }

  return result;
}

function dagreLayout(
  nodes: EngGraphNode[],
  edges: EngGraphEdge[],
  direction: 'TB' | 'LR',
): Positioned[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    // Generous separation: labels are the point of this graph, and nodes
    // that touch make them unreadable at any zoom.
    nodesep: direction === 'TB' ? 28 : 22,
    ranksep: direction === 'TB' ? 72 : 110,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    // Dagre throws on an edge to an unknown node; the view layer should
    // already have filtered those, but a layout must not be the thing that
    // crashes if one slips through.
    if (graph.hasNode(edge.sourceNodeId) && graph.hasNode(edge.targetNodeId)) {
      graph.setEdge(edge.sourceNodeId, edge.targetNodeId);
    }
  }

  dagre.layout(graph);

  const placed = nodes.map((node) => {
    const positioned = graph.node(node.id) as { x: number; y: number } | undefined;
    return {
      id: node.id,
      // React Flow positions from the top-left; dagre reports centres.
      x: (positioned?.x ?? 0) - NODE_WIDTH / 2,
      y: (positioned?.y ?? 0) - NODE_HEIGHT / 2,
    };
  });

  return wrapWideRanks(placed, direction, nodes.length);
}

/** Concentric rings, ordered within each ring so same-type nodes sit together. */
function radialLayout(nodes: EngGraphNode[]): Positioned[] {
  const rings = new Map<number, EngGraphNode[]>();
  for (const node of nodes) {
    const ring = RING[node.type];
    const list = rings.get(ring);
    if (list) list.push(node);
    else rings.set(ring, [node]);
  }

  const positions: Positioned[] = [];
  for (const [ring, members] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    members.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

    if (ring === 0) {
      for (const node of members) positions.push({ id: node.id, x: 0, y: 0 });
      continue;
    }

    // Radius grows with both ring index and crowding, so a ring of sixty
    // packages does not overlap the ring inside it.
    const radius = ring * 240 + Math.max(0, members.length - 12) * 9;
    for (const [index, node] of members.entries()) {
      const angle = (index / members.length) * Math.PI * 2 - Math.PI / 2;
      positions.push({
        id: node.id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.72,
      });
    }
  }
  return positions;
}

export function layoutGraph(
  nodes: EngGraphNode[],
  edges: EngGraphEdge[],
  layout: LayoutId,
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  const positioned =
    layout === 'radial'
      ? radialLayout(nodes)
      : dagreLayout(nodes, edges, layout === 'dependency' ? 'LR' : 'TB');

  return new Map(positioned.map((entry) => [entry.id, { x: entry.x, y: entry.y }]));
}
