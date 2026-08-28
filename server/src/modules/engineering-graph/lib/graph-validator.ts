/**
 * Structural checks on a built graph.
 *
 * The distinction that matters here is between a *defect* and a *shape
 * worth looking at*. A dangling edge is a defect: it points at a node that
 * does not exist and every traversal through it is wrong. A cycle is not.
 * Plenty of real architectures contain them legitimately — two services
 * that call each other, a self-referential entity like a category tree.
 *
 * So cycles are reported as warnings with the nodes named, never removed,
 * and only when they look suspicious: a cycle confined to `CONTAINS` edges
 * means a containment loop, which genuinely cannot be right. A cycle
 * through `USES` is just coupling, and the user gets to decide whether it
 * bothers them.
 */
import type {
  GraphEdge,
  GraphIssue,
  GraphNode,
  GraphRelationship,
  GraphValidationReport,
} from '../../../shared/contracts/index.js';
import { GRAPH_RELATIONSHIPS } from '../../../shared/contracts/index.js';

/** Relationships that describe structure and therefore must not loop. */
const HIERARCHICAL: GraphRelationship[] = ['CONTAINS', 'GENERATES'];

/** Node types that are legitimately leaves — never flagged as orphans. */
const LEAF_TYPES = new Set(['FIELD', 'FILE', 'TEST', 'DEPENDENCY', 'API', 'SECURITY_RULE']);

export function validateGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphValidationReport {
  const issues: GraphIssue[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const connected = new Set<string>();
  const relationships = new Set<string>(GRAPH_RELATIONSHIPS);

  const seenEdgeKeys = new Set<string>();

  for (const edge of edges) {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);

    if (!source || !target) {
      issues.push({
        kind: 'dangling-edge',
        severity: 'error',
        message: `Edge ${edge.relationship} references a node that does not exist in this project`,
        nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      });
      continue;
    }

    if (!relationships.has(edge.relationship)) {
      issues.push({
        kind: 'invalid-relationship',
        severity: 'error',
        message: `Unknown relationship "${edge.relationship}" between ${source.name} and ${target.name}`,
        nodeIds: [source.id, target.id],
      });
    }

    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push({
        kind: 'self-loop',
        severity: 'warning',
        message: `${source.name} ${edge.relationship} itself`,
        nodeIds: [source.id],
      });
    }

    const key = `${edge.sourceNodeId}|${edge.relationship}|${edge.targetNodeId}`;
    if (seenEdgeKeys.has(key)) {
      issues.push({
        kind: 'duplicate-edge',
        severity: 'warning',
        message: `Duplicate ${edge.relationship} edge from ${source.name} to ${target.name}`,
        nodeIds: [source.id, target.id],
      });
    }
    seenEdgeKeys.add(key);

    connected.add(edge.sourceNodeId);
    connected.add(edge.targetNodeId);
  }

  for (const node of nodes) {
    // The project root has no parent by definition, and leaf types are
    // expected to sit at the end of a chain.
    if (node.type === 'PROJECT' || LEAF_TYPES.has(node.type)) continue;
    if (connected.has(node.id)) continue;
    issues.push({
      kind: 'orphan-node',
      severity: 'warning',
      message: `${node.type} "${node.name}" is not connected to anything`,
      nodeIds: [node.id],
    });
  }

  for (const cycle of findHierarchicalCycles(nodes, edges)) {
    issues.push({
      kind: 'suspicious-cycle',
      severity: 'warning',
      message: `Containment cycle: ${cycle.map((node) => node.name).join(' → ')}`,
      nodeIds: cycle.map((node) => node.id),
    });
  }

  return {
    // Warnings describe a graph worth looking at; only errors make it wrong.
    valid: issues.every((issue) => issue.severity !== 'error'),
    checkedNodes: nodes.length,
    checkedEdges: edges.length,
    issues,
  };
}

/** Cycles reachable through hierarchical edges only — those cannot be legitimate. */
function findHierarchicalCycles(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!HIERARCHICAL.includes(edge.relationship)) continue;
    const list = adjacency.get(edge.sourceNodeId);
    if (list) list.push(edge.targetNodeId);
    else adjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
  }

  const cycles: GraphNode[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const walk = (id: string): void => {
    state.set(id, 'visiting');
    stack.push(id);

    for (const next of adjacency.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === 'visiting') {
        const start = stack.indexOf(next);
        const cycle = stack
          .slice(start)
          .map((nodeId) => byId.get(nodeId))
          .filter((node): node is GraphNode => Boolean(node));
        if (cycle.length > 0) cycles.push(cycle);
        continue;
      }
      if (seen === undefined) walk(next);
    }

    stack.pop();
    state.set(id, 'done');
  };

  for (const node of nodes) {
    if (!state.has(node.id)) walk(node.id);
  }
  return cycles;
}
