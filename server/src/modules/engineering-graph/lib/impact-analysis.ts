/**
 * What else does this touch?
 *
 * Pure graph traversal — no model call. If the Payment service changes,
 * the things at risk are the things that reach it: the Order service that
 * uses it, the endpoints that expose those, the pages that call them. The
 * graph already records every one of those relationships, so the answer is
 * a walk, not a judgement.
 *
 * Direction is `incoming`, which is the part worth getting right. A
 * node's *dependencies* are what it needs; its *dependents* are what
 * breaks when it changes. Impact analysis wants the second, so it walks
 * edges backwards — from a node to whatever points at it.
 *
 * One exception: `CONTAINS` is followed downward as well. Changing an
 * entity affects its fields even though the fields point at nothing.
 */
import type {
  GraphNode,
  GraphNodeType,
  GraphRelationship,
  ImpactAnalysis,
  ImpactedNode,
} from '../../../shared/contracts/index.js';
import { indexGraph, traverse } from './graph-queries.js';
import type { GraphIndex } from './graph-queries.js';

/** Plain-language reason a relationship propagates impact. */
const REASONS: Record<GraphRelationship, string> = {
  CONTAINS: 'is contained by the changed node',
  IMPLEMENTS: 'implements the changed node',
  DEPENDS_ON: 'depends on the changed node',
  USES: 'uses the changed node',
  CALLS: 'calls the changed node',
  EXPOSES: 'exposes the changed node',
  PERSISTS: 'persists the changed node',
  BELONGS_TO: 'holds a reference to the changed node',
  GENERATES: 'was generated from the changed node',
  VALIDATES: 'validates the changed node',
  TESTS: 'tests the changed node',
  SECURED_BY: 'is secured by the changed node',
  TARGETS: 'reports a finding against the changed node',
};

export function analyzeImpact(index: GraphIndex, origin: GraphNode, maxDepth = 3): ImpactAnalysis {
  // Dependents: everything that points at this node, transitively.
  const upstream = traverse(index, origin.id, 'incoming', { maxDepth, limit: 400 });

  // Contained children: changing a table changes its columns, and those
  // are reached by following CONTAINS forwards rather than backwards.
  const contained = traverse(index, origin.id, 'outgoing', {
    maxDepth,
    relationships: ['CONTAINS', 'GENERATES'],
    limit: 400,
  });

  const seen = new Set<string>([origin.id]);
  const impacted: ImpactedNode[] = [];

  for (const related of [...upstream, ...contained]) {
    if (seen.has(related.node.id)) continue;
    seen.add(related.node.id);
    impacted.push({
      node: related.node,
      depth: related.depth,
      via: related.via,
      reason: `${related.node.name} ${REASONS[related.via]}`,
    });
  }

  impacted.sort((a, b) => a.depth - b.depth || a.node.type.localeCompare(b.node.type));

  const summary: Partial<Record<GraphNodeType, number>> = {};
  for (const entry of impacted) {
    summary[entry.node.type] = (summary[entry.node.type] ?? 0) + 1;
  }

  return { origin, impacted, summary, maxDepth };
}

/** Convenience for callers holding raw nodes/edges rather than an index. */
export function analyzeImpactFor(
  nodes: GraphNode[],
  edges: Parameters<typeof indexGraph>[1],
  origin: GraphNode,
  maxDepth = 3,
): ImpactAnalysis {
  return analyzeImpact(indexGraph(nodes, edges), origin, maxDepth);
}
