/**
 * Structural checks on a built graph.
 *
 * The distinction that matters here is between a *defect* and a *shape
 * worth looking at*. An edge whose endpoint is missing is a defect: every
 * traversal through it is wrong. A cycle is not. Plenty of real
 * architectures contain them legitimately — two services that call each
 * other, a self-referential entity like a category tree.
 *
 * So cycles are reported as warnings with the nodes named, never removed,
 * and only when they look suspicious: a cycle confined to `CONTAINS` edges
 * means a containment loop, which genuinely cannot be right. A cycle
 * through `USES` is just coupling, and the user gets to decide whether it
 * bothers them.
 *
 * The second rule, learned the hard way: a check that cannot fire must not
 * be advertised. This function used to run three of them — duplicate edges,
 * unknown relationships, self-loops — none of which any writer in this
 * system can produce, because the unique index, the enum column and the
 * builder's own edge guard respectively make them unrepresentable. A report
 * listing checks that are structurally incapable of failing reads as
 * thorough while telling the reader nothing, so those three are gone and
 * their space is taken by things the stored data genuinely evidences: links
 * the builder could not resolve, file paths nothing in the graph holds, and
 * nodes written by a run other than the latest build.
 *
 * Anything a check cannot see is named in `skippedChecks` rather than
 * passing silently.
 */
import type {
  GraphEdge,
  GraphIssue,
  GraphIssueKind,
  GraphNode,
  GraphRelationship,
  GraphValidationReport,
} from '../../../shared/contracts/engineering-graph.js';
import { canonicalizePath } from './canonical.js';

/** Relationships that describe structure and therefore must not loop. */
const HIERARCHICAL: GraphRelationship[] = ['CONTAINS', 'GENERATES'];

/** How many node ids an aggregated issue names before it stops listing them. */
const MAX_LISTED_NODES = 50;

export interface GraphValidationOptions {
  /**
   * The project's latest completed run, when the caller knows it. Staleness
   * is a comparison against it and simply cannot be computed without it —
   * the graph itself cannot say which of the runs it spans is the newest
   * *build*, only which is the newest write.
   */
  latestRunId?: string;
}

export function validateGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: GraphValidationOptions = {},
): GraphValidationReport {
  const issues: GraphIssue[] = [];
  const skippedChecks: GraphIssueKind[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const connected = new Set<string>();

  for (const edge of edges) {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);

    if (!source || !target) {
      /*
       * Not a stored defect: the foreign keys cascade, so the database
       * cannot hold an edge whose endpoint row is gone. What this does
       * catch is a torn read — nodes and edges are two queries, and a sync
       * landing between them can remove a node the edge list still names.
       * The edge is wrong *for this answer*, which is what an error means
       * here, and the message says so rather than accusing the store.
       */
      issues.push({
        kind: 'dangling-edge',
        severity: 'error',
        message: `Edge ${edge.relationship} names a node this graph does not contain — it was probably removed while the graph was being read`,
        nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      });
      continue;
    }

    connected.add(edge.sourceNodeId);
    connected.add(edge.targetNodeId);
  }

  /*
   * Orphans, per type.
   *
   * There used to be a hand-maintained set of "leaf types" exempted from
   * this check, which was wrong in both directions: it suppressed FIELD,
   * FILE, TEST, DEPENDENCY, API and SECURITY_RULE, every one of which the
   * builder does give an edge (a field is CONTAINS'd by its entity, an API
   * is EXPOSEd by its feature, a dependency is DEPENDS_ON'd by the project),
   * while omitting FOLDER and FINDING, which were therefore reported as
   * orphans on every graph despite also always having one.
   *
   * Audited against the builder, every type it emits is given at least one
   * edge at the point it is created — except PROJECT, which is the root and
   * has nothing above it. So the rule is simply that: a non-root node with
   * no edges is a gap, and the gaps that reach here are real ones. A node
   * can lose its only edge when a scoped sync deletes the node at the other
   * end — an RBAC rule whose entity was dropped, for instance — and that is
   * exactly the thing worth reporting.
   */
  for (const node of nodes) {
    if (node.type === 'PROJECT') continue;
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

  issues.push(...unresolvedLinks(nodes));
  issues.push(...fileReferences(nodes, skippedChecks));
  issues.push(...staleNodes(nodes, skippedChecks, options.latestRunId));
  issues.push(...cappedFileTree(nodes));

  return {
    // Warnings describe a graph worth looking at; only errors make it wrong.
    valid: issues.every((issue) => issue.severity !== 'error'),
    checkedNodes: nodes.length,
    checkedEdges: edges.length,
    issues,
    skippedChecks,
  };
}

/**
 * The links the builder could not make, read back off the nodes.
 *
 * The builder writes a miss down because it has no issue channel of its own:
 * a FEATURE whose requirement name matched nothing records
 * `unresolvedRequirements`, and a FINDING whose review agent named a node
 * the graph does not hold records `unresolvedTargetNodeId`. Both were
 * persisted and nothing ever read them, so the one thing a person could
 * actually fix — a name spelled too differently to match — stayed invisible.
 * Nothing is derived here; the gap is already in the data.
 */
function unresolvedLinks(nodes: GraphNode[]): GraphIssue[] {
  const issues: GraphIssue[] = [];

  for (const node of nodes) {
    for (const name of asStringList(fieldOf(node.metadata.unresolvedRequirements, 'names'))) {
      issues.push({
        kind: 'unresolved-requirement-link',
        severity: 'warning',
        message: `${node.type} "${node.name}" implements "${name}", which no REQUIREMENT node matches`,
        nodeIds: [node.id],
      });
    }

    const stated = fieldOf(node.metadata.unresolvedTargetNodeId, 'targetNodeId');
    if (typeof stated === 'string' && stated.length > 0) {
      issues.push({
        kind: 'unresolved-finding-target',
        severity: 'warning',
        message: `${node.type} "${node.name}" is reported against "${stated}", which is not a node in this graph`,
        nodeIds: [node.id],
      });
    }
  }

  return issues;
}

/**
 * Nodes that state a file path the graph holds no file node for.
 *
 * Only `targetFile` is read, and only when the graph has a file tree at all.
 * A graph synced from the planning artifacts alone has no FILE nodes, and
 * reporting every finding's file as missing in that case would be claiming a
 * problem the data does not evidence — the tree was never mapped, which the
 * skipped-check list says instead.
 */
function fileReferences(nodes: GraphNode[], skipped: GraphIssueKind[]): GraphIssue[] {
  const filePaths = new Set(
    nodes
      .filter((node) => node.type === 'FILE' || node.type === 'TEST')
      .map((n) => n.canonicalName),
  );
  if (filePaths.size === 0) {
    skipped.push('missing-file-reference');
    return [];
  }

  const issues: GraphIssue[] = [];
  for (const node of nodes) {
    const stated = node.metadata.targetFile;
    if (typeof stated !== 'string' || stated.length === 0) continue;
    if (filePaths.has(canonicalizePath(stated))) continue;
    issues.push({
      kind: 'missing-file-reference',
      severity: 'warning',
      message: `${node.type} "${node.name}" is about ${stated}, which this graph holds no file node for`,
      nodeIds: [node.id],
    });
  }
  return issues;
}

/**
 * Nodes last written by a run older than the project's latest build.
 *
 * Reported as one issue rather than one per node: a graph half-refreshed by
 * a mesh sync can leave hundreds, and three hundred identical warnings is a
 * worse answer than one that counts them. Severity is `info` because a graph
 * spanning runs is normal — the pipeline and the agent mesh both write here
 * — and staleness is something the reader should weigh, not a defect.
 */
function staleNodes(
  nodes: GraphNode[],
  skipped: GraphIssueKind[],
  latestRunId: string | undefined,
): GraphIssue[] {
  if (latestRunId === undefined || latestRunId === '') {
    skipped.push('stale-node');
    return [];
  }

  const stale = nodes.filter((node) => node.runId !== latestRunId);
  if (stale.length === 0) return [];

  // Says "a different run", not "an earlier run".
  //
  // All this check can see is that the ids differ. A graph is resynchronised
  // by three producers — the pipeline, the agent mesh and an applied edit —
  // and two of them stamp their own session id, which is not a Generation id
  // and cannot be ordered against one. So nodes written *after* the latest
  // build are just as likely as nodes written before it, and claiming they
  // are older is an assertion the data does not support.
  return [
    {
      kind: 'stale-node',
      severity: 'info',
      message: `${String(stale.length)} of ${String(nodes.length)} nodes were last written by a run other than the latest completed build (${latestRunId}), so part of this graph may describe different files`,
      nodeIds: stale.slice(0, MAX_LISTED_NODES).map((node) => node.id),
    },
  ];
}

/** The builder's file cap, if it bit. Written on the PROJECT node, read here. */
function cappedFileTree(nodes: GraphNode[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const node of nodes) {
    const cap = fieldOf(node.metadata.fileTreeCap, 'cap');
    const total = fieldOf(node.metadata.fileTreeCap, 'totalFiles');
    if (typeof cap !== 'number' || typeof total !== 'number') continue;
    issues.push({
      kind: 'truncated-file-tree',
      severity: 'info',
      message: `This graph maps ${String(cap)} of ${String(total)} project files — the rest were left out of the file tree`,
      nodeIds: [node.id],
    });
  }
  return issues;
}

/**
 * One field of a metadata object that survived a round trip through a JSON
 * column, where nothing guarantees its shape. Narrowed rather than asserted.
 */
function fieldOf(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null || !(field in value)) return undefined;
  return (value as Record<string, unknown>)[field];
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
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
