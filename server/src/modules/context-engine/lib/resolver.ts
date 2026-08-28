/**
 * Request in, scored nodes out.
 *
 * The resolver walks the Engineering Graph outward from the task's target
 * nodes, bounded by depth, and scores everything it reaches. What it does
 * *not* do is load the project — bounded traversal is the whole mechanism,
 * because "start from everything and filter" has the same cost as sending
 * everything.
 *
 * `FULL` mode exists as the control arm of the benchmark. It takes every
 * node, which is precisely the behaviour the engine was built to replace,
 * and it is here so the replacement can be measured rather than asserted.
 */
import type { GraphEdge, GraphNode, GraphNodeType } from '../../../shared/contracts/index.js';
import { indexGraph, traverse } from '../../engineering-graph/lib/graph-queries.js';
import { budgetFor } from './budgets.js';
import { scoreNode, taskNodeTypes } from './relevance.js';
import type {
  ContextRequest,
  ExcludedNode,
  ScoredNode,
  TaskType,
} from '../context-engine.types.js';

export interface ResolutionResult {
  selected: ScoredNode[];
  excluded: ExcludedNode[];
  considered: number;
}

/** Targets named rather than addressed — the form a caller usually has. */
function resolveTargets(nodes: GraphNode[], request: ContextRequest): GraphNode[] {
  const byId = new Set(request.targetNodeIds ?? []);
  const wanted = (request.targetNames ?? []).map((name) => name.trim().toLowerCase());

  return nodes.filter(
    (node) =>
      byId.has(node.id) ||
      wanted.some(
        (name) =>
          node.name.toLowerCase() === name ||
          node.canonicalName === name ||
          // A caller asking for "order service" should find `OrderService`.
          node.canonicalName === name.replace(/[^a-z0-9]+/g, '-').replace(/-service$|-$/g, ''),
      ),
  );
}

/** The module or feature a node belongs to, for the same-module signal. */
function moduleOf(nodeId: string, edges: GraphEdge[], byId: Map<string, GraphNode>): string | null {
  for (const edge of edges) {
    if (edge.targetNodeId !== nodeId) continue;
    const parent = byId.get(edge.sourceNodeId);
    if (parent && (parent.type === 'MODULE' || parent.type === 'FEATURE')) return parent.id;
  }
  return null;
}

export function resolveContext(
  nodes: GraphNode[],
  edges: GraphEdge[],
  request: ContextRequest,
): ResolutionResult {
  const task: TaskType = request.taskType;
  const budget = budgetFor(task);
  const mode = request.mode ?? 'SELECTIVE';

  if (mode === 'FULL') {
    /*
     * The control arm: everything, unselected, in graph order.
     *
     * The target still keeps its `TARGET` reason. Without that the
     * compiler had no TARGET section to write and rendered the node being
     * worked on as one more summary line in WIDER CONTEXT — so FULL, which
     * sends strictly more nodes, told the model strictly less about the
     * one node that mattered. Not selecting is the point of this mode;
     * losing the subject of the task is not.
     */
    const targetIds = new Set(resolveTargets(nodes, request).map((node) => node.id));
    return {
      selected: nodes.map((node) => ({
        node,
        score: 1,
        reason: targetIds.has(node.id) ? ('TARGET' as const) : ('FULL_MODE' as const),
        depth: 0,
      })),
      excluded: [],
      considered: nodes.length,
    };
  }

  const index = indexGraph(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const requiredTypes: GraphNodeType[] = request.requiredNodeTypes ?? [];
  const depth = Math.max(0, Math.min(request.dependencyDepth ?? budget.defaultDepth, 4));

  const targets = resolveTargets(nodes, request);

  /**
   * With no target the task is project-wide, and the relevant set is the
   * types the task reasons over — not the whole graph.
   */
  const effectiveTargets =
    targets.length > 0
      ? targets
      : nodes.filter(
          (node) =>
            node.type === 'PROJECT' ||
            requiredTypes.includes(node.type) ||
            taskNodeTypes(task).includes(node.type),
        );

  const targetIds = new Set(effectiveTargets.map((node) => node.id));
  const targetModules = new Set(
    effectiveTargets.map((node) => moduleOf(node.id, edges, byId)).filter(Boolean) as string[],
  );

  // Walk outward from each target, keeping the shortest depth per node.
  const reached = new Map<string, { depth: number; outgoing: boolean; incoming: boolean }>();
  for (const target of effectiveTargets) {
    if (request.includeDependencies !== false) {
      for (const related of traverse(index, target.id, 'outgoing', {
        maxDepth: depth,
        limit: 600,
      })) {
        const existing = reached.get(related.node.id);
        if (!existing || related.depth < existing.depth) {
          reached.set(related.node.id, {
            depth: related.depth,
            outgoing: true,
            incoming: existing?.incoming ?? false,
          });
        } else existing.outgoing = true;
      }
    }
    if (request.includeDependents) {
      for (const related of traverse(index, target.id, 'incoming', {
        maxDepth: depth,
        limit: 600,
      })) {
        const existing = reached.get(related.node.id);
        if (!existing || related.depth < existing.depth) {
          reached.set(related.node.id, {
            depth: related.depth,
            outgoing: existing?.outgoing ?? false,
            incoming: true,
          });
        } else existing.incoming = true;
      }
    }

    /**
     * A third, undirected pass — and it is not redundant.
     *
     * The directed walks never change direction mid-path, so a node
     * reachable only by going *up* and then *down* stays invisible. That is
     * exactly where a project's requirements live: a service is contained
     * by a module, which implements a feature, which implements the
     * requirement. Walking outward from the service never arrives, and the
     * first run of this engine duly excluded every requirement from a
     * backend-generation context — the one thing that explains why the code
     * exists.
     *
     * The pass is bounded by the same depth, and everything it finds is
     * still scored: relevance decides what survives, not reachability.
     */
    for (const related of traverse(index, target.id, 'both', { maxDepth: depth, limit: 800 })) {
      const existing = reached.get(related.node.id);
      if (!existing) {
        reached.set(related.node.id, { depth: related.depth, outgoing: false, incoming: false });
      } else if (related.depth < existing.depth) {
        existing.depth = related.depth;
      }
    }
  }

  /**
   * The requirements behind what was selected.
   *
   * A requirement sits three hops from a service — service, module,
   * feature, requirement — so no depth-2 walk reaches one, and widening
   * every traversal by a hop to catch them would drag in a great deal that
   * is genuinely irrelevant. Instead the linkage is followed directly:
   * whatever feature or module survived selection, the requirement it
   * implements comes with it.
   *
   * This is the "why does this code exist" half of the context, and a
   * generation task without it is working from structure alone.
   */
  const requirementIds = new Set<string>();
  const reachedOrTarget = (id: string): boolean => targetIds.has(id) || reached.has(id);
  for (const edge of edges) {
    if (edge.relationship !== 'IMPLEMENTS') continue;
    if (!reachedOrTarget(edge.sourceNodeId)) continue;
    const target = byId.get(edge.targetNodeId);
    if (!target) continue;
    if (target.type === 'REQUIREMENT') requirementIds.add(target.id);
    // Module → feature → requirement: follow the second hop too.
    if (target.type === 'FEATURE') {
      for (const next of edges) {
        if (next.relationship !== 'IMPLEMENTS' || next.sourceNodeId !== target.id) continue;
        const requirement = byId.get(next.targetNodeId);
        if (requirement?.type === 'REQUIREMENT') requirementIds.add(requirement.id);
      }
    }
  }

  const selected: ScoredNode[] = [];
  const excluded: ExcludedNode[] = [];

  for (const node of nodes) {
    const isTarget = targetIds.has(node.id);
    const hit = reached.get(node.id);
    const isLinkedRequirement = requirementIds.has(node.id);

    if (!isTarget && !hit && !isLinkedRequirement) {
      // Never reached from any target — the case this engine exists to skip.
      excluded.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        reason: 'NOT_RELEVANT',
        score: 0,
      });
      continue;
    }

    const { score, reason } = scoreNode({
      node,
      depth: isTarget ? 0 : (hit?.depth ?? 2),
      isTarget,
      isDirectDependency: (hit?.depth ?? 9) === 1 && Boolean(hit?.outgoing),
      isDirectDependent: (hit?.depth ?? 9) === 1 && Boolean(hit?.incoming) && !hit?.outgoing,
      sharesModule: targetModules.has(moduleOf(node.id, edges, byId) ?? ''),
      task,
      requiredTypes,
    });

    if (!isTarget && score < budget.minScore) {
      excluded.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        reason: 'BELOW_THRESHOLD',
        score,
      });
      continue;
    }

    selected.push({ node, score, reason, depth: isTarget ? 0 : (hit?.depth ?? 1) });
  }

  // Highest relevance first — this ordering is what makes truncation safe.
  selected.sort(
    (a, b) => b.score - a.score || a.depth - b.depth || a.node.name.localeCompare(b.node.name),
  );

  return { selected, excluded, considered: nodes.length };
}
