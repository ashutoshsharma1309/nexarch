/**
 * Shapes the assembled nodes/edges into the three JSON exports:
 * dependency-graph.json (the graph itself, with metadata counts),
 * graph-layout.json (a deterministic grouped-column layout — no client-side
 * physics simulation needed since positions are precomputed here), and
 * dependency-stats.json (the numbers the dashboard's stat cards read).
 */
import type {
  DependencyGraph,
  DependencyStats,
  EdgeType,
  GraphEdge,
  GraphLayout,
  GraphNode,
  LayoutGroup,
  ModuleGroup,
  NodeType,
} from '../dependency-graph.types.js';
import {
  buildAdjacency,
  computeDepth,
  detectCycles,
  findOrphanNodes,
  structuralEdges,
} from './graph-optimizer.js';

const GROUP_ORDER: ModuleGroup[] = ['frontend', 'backend', 'security', 'database', 'shared'];
const GROUP_COLOR: Record<ModuleGroup, string> = {
  frontend: '#6366f1',
  backend: '#22c55e',
  security: '#ef4444',
  database: '#f59e0b',
  shared: '#64748b',
};
const GROUP_LABEL: Record<ModuleGroup, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  security: 'Security',
  shared: 'Shared',
};

const COLS = 4;
const NODE_W = 200;
const NODE_H = 64;
const GAP = 24;
const GROUP_GAP = 96;
const GROUP_PADDING = 32;
const GROUP_HEADER = 48;

export function buildDependencyGraph(
  projectName: string,
  projectType: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  sources: string[],
): DependencyGraph {
  const nodesByGroup = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<
    ModuleGroup,
    number
  >;
  for (const node of nodes) nodesByGroup[node.group] += 1;

  const edgesByType: Partial<Record<EdgeType, number>> = {};
  for (const edge of edges) edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;

  return {
    meta: {
      projectName,
      projectType,
      generatedAt: new Date().toISOString(),
      generator: 'NexArch Dependency Graph Engine',
      sources,
    },
    nodes,
    edges,
    metadata: { nodeCount: nodes.length, edgeCount: edges.length, nodesByGroup, edgesByType },
  };
}

export function buildGraphLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  const byGroup = new Map<ModuleGroup, GraphNode[]>();
  for (const node of nodes) {
    const list = byGroup.get(node.group) ?? [];
    list.push(node);
    byGroup.set(node.group, list);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
  }

  const layoutNodes: GraphLayout['nodes'] = [];
  const groups: LayoutGroup[] = [];
  let groupX = 0;

  for (const group of GROUP_ORDER) {
    const groupNodes = byGroup.get(group) ?? [];
    if (groupNodes.length === 0) continue;

    const rows = Math.ceil(groupNodes.length / COLS);
    const width = COLS * NODE_W + (COLS - 1) * GAP + GROUP_PADDING * 2;
    const height = rows * NODE_H + Math.max(0, rows - 1) * GAP + GROUP_PADDING * 2 + GROUP_HEADER;

    groupNodes.forEach((node, index) => {
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      layoutNodes.push({
        id: node.id,
        x: groupX + GROUP_PADDING + col * (NODE_W + GAP),
        y: GROUP_HEADER + GROUP_PADDING + row * (NODE_H + GAP),
        group: node.group,
        type: node.type,
      });
    });

    groups.push({
      id: group,
      label: GROUP_LABEL[group],
      color: GROUP_COLOR[group],
      x: groupX,
      y: 0,
      width,
      height,
    });
    groupX += width + GROUP_GAP;
  }

  return {
    nodes: layoutNodes,
    groups,
    edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, type: e.type })),
  };
}

export function buildDependencyStats(nodes: GraphNode[], edges: GraphEdge[]): DependencyStats {
  const adjacency = buildAdjacency(nodes, structuralEdges(edges));
  const cycles = detectCycles(nodes, adjacency);
  const orphans = findOrphanNodes(nodes, adjacency);
  const depth = computeDepth(nodes, adjacency);

  const nodesByGroup = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<
    ModuleGroup,
    number
  >;
  for (const node of nodes) nodesByGroup[node.group] += 1;

  const nodesByType: Partial<Record<NodeType, number>> = {};
  for (const node of nodes) nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    averageDependencyDepth: depth.average,
    maxDependencyDepth: depth.max,
    circularDependencyCount: cycles.length,
    orphanFileCount: orphans.length,
    nodesByGroup,
    nodesByType,
  };
}
