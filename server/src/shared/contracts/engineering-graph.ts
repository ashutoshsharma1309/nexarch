/**
 * Engineering Graph contracts.
 *
 * One structured, queryable representation of a project: what was asked
 * for, what was planned, what was generated, and how all of it connects.
 * Every other v2 capability — context selection, agent coordination,
 * impact analysis, visualization — reads this rather than re-deriving
 * relationships from eight separate artifact shapes.
 *
 * Two properties are load-bearing and worth stating plainly:
 *
 *   • It is **deterministic**. Every node and edge is derived from an
 *     existing artifact by code. No model call participates in building
 *     it, because "Order has a foreign key to User" is a fact the
 *     database design already states — asking an LLM to restate it would
 *     be slower, cost money, and be occasionally wrong.
 *
 *   • It is **traceable**. Every node carries the artifact it came from,
 *     so a node in the graph can always be resolved back to the thing
 *     that produced it.
 *
 * The Dependency Graph Engine is not replaced by this. It remains the
 * authority on *code* structure — imports, calls, queries between
 * generated files — and this graph sits a level above it, in the
 * vocabulary of the product rather than of the source tree.
 */
import type { ArtifactType } from './artifact.js';

/**
 * What a node can be.
 *
 * Each type maps to exactly one concept that the artifacts genuinely
 * distinguish. `MODULE` and `SERVICE` are separate because the plan and
 * the generated code separate them (an `orders` module contains an
 * `OrderService`); `REQUIREMENT` and `FEATURE` are separate because the
 * planner is free to merge or split what was asked for.
 */
export type GraphNodeType =
  | 'PROJECT'
  | 'REQUIREMENT'
  | 'FEATURE'
  | 'COMPONENT'
  | 'SERVICE'
  | 'API'
  | 'ENTITY'
  | 'FIELD'
  | 'FILE'
  /** A directory of the generated project. CONTAINS its files and subfolders. */
  | 'FOLDER'
  | 'MODULE'
  | 'SECURITY_RULE'
  | 'DEPENDENCY'
  | 'TEST'
  /** Something a review agent found. Linked to what it concerns by TARGETS. */
  | 'FINDING';

export const GRAPH_NODE_TYPES: readonly GraphNodeType[] = [
  'PROJECT',
  'REQUIREMENT',
  'FEATURE',
  'COMPONENT',
  'SERVICE',
  'API',
  'ENTITY',
  'FIELD',
  'FILE',
  'FOLDER',
  'MODULE',
  'SECURITY_RULE',
  'DEPENDENCY',
  'TEST',
  'FINDING',
];

/**
 * How nodes relate.
 *
 * Deliberately small and non-overlapping: one name per meaning, so a
 * traversal never has to ask whether `USES` and `DEPENDS_ON` mean the
 * same thing here. `DEPENDS_ON` is for external packages, `USES` for
 * service-to-service coupling, `CALLS` for a client invoking an endpoint.
 */
export type GraphRelationship =
  | 'CONTAINS'
  | 'IMPLEMENTS'
  | 'DEPENDS_ON'
  | 'USES'
  | 'CALLS'
  | 'EXPOSES'
  | 'PERSISTS'
  | 'BELONGS_TO'
  | 'GENERATES'
  | 'VALIDATES'
  | 'TESTS'
  | 'SECURED_BY'
  /** Finding → the node it concerns. The edge impact analysis walks. */
  | 'TARGETS';

export const GRAPH_RELATIONSHIPS: readonly GraphRelationship[] = [
  'CONTAINS',
  'IMPLEMENTS',
  'DEPENDS_ON',
  'USES',
  'CALLS',
  'EXPOSES',
  'PERSISTS',
  'BELONGS_TO',
  'GENERATES',
  'VALIDATES',
  'TESTS',
  'SECURED_BY',
  'TARGETS',
];

export interface GraphNode {
  id: string;
  projectId: string;
  /** The run that last produced or refreshed this node. */
  runId: string;
  type: GraphNodeType;
  /**
   * Stable identity within `(projectId, type)`. Two artifacts naming the
   * same thing differently — "User Service", "user-service" — resolve to
   * one node through this, and never to one node across *types*.
   */
  canonicalName: string;
  /** Human-facing name, as the artifact spelled it. */
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  /** Which artifact this node was derived from. Null only for the project root. */
  sourceArtifactId: ArtifactType | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  projectId: string;
  runId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: GraphRelationship;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EngineeringGraph {
  projectId: string;
  /**
   * The run this graph describes, or null when its nodes came from several
   * runs (the pipeline and the agent mesh both write here) or there are none.
   * Naming one run in that case would present a partial map as the whole.
   */
  runId: string | null;
  /** Every run represented, so the UI can say the graph spans more than one. */
  runIds: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  /** When the graph was last written — not when it was read. Null if empty. */
  generatedAt: string | null;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Partial<Record<GraphNodeType, number>>;
  edgesByRelationship: Partial<Record<GraphRelationship, number>>;
}

/* ── Building ─────────────────────────────────────────────────────────── */

/**
 * What the builder emits before anything is persisted. Nodes are keyed by
 * `(type, canonicalName)` rather than by database id, because the id is
 * assigned on write and edges have to be expressible before that happens.
 */
export interface DraftNode {
  type: GraphNodeType;
  canonicalName: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  sourceArtifactId: ArtifactType | null;
}

export interface DraftEdge {
  from: { type: GraphNodeType; canonicalName: string };
  to: { type: GraphNodeType; canonicalName: string };
  relationship: GraphRelationship;
  metadata?: Record<string, unknown>;
}

export interface GraphDraft {
  nodes: DraftNode[];
  edges: DraftEdge[];
}

/** What one synchronization actually changed. */
export interface GraphSyncResult {
  nodesCreated: number;
  nodesUpdated: number;
  nodesRemoved: number;
  edgesCreated: number;
  edgesRemoved: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

/* ── Querying ─────────────────────────────────────────────────────────── */

export type TraversalDirection = 'outgoing' | 'incoming' | 'both';

export interface TraversalOptions {
  /** Follow only these relationships; omit for all. */
  relationships?: GraphRelationship[];
  /** Restrict results to these node types; omit for all. */
  nodeTypes?: GraphNodeType[];
  /**
   * Node types the walk may not pass *through*, and never reports.
   *
   * `nodeTypes` filters what comes back but still expands what it filters
   * out, which is right for most questions and wrong for one: the project
   * root CONTAINS everything, so any walk allowed through it reaches the
   * whole graph in two hops and a trace from a requirement "reaches" every
   * file in the project. Pruning the frontier is the only way to say that.
   */
  excludeNodeTypes?: GraphNodeType[];
  /** How many hops to walk. Bounded so a query cannot pull the whole graph. */
  maxDepth?: number;
  limit?: number;
}

/** A node reached by traversal, with how far away it was and how it was reached. */
export interface RelatedNode {
  node: GraphNode;
  depth: number;
  /** The relationship on the edge that reached this node. */
  via: GraphRelationship;
}

/**
 * A bounded walk's results, and whether the bound cut them short.
 *
 * The list alone cannot say this: 200 results because the graph holds 200
 * and 200 results because the cap stopped the walk look identical, and the
 * second one read as the first is a partial answer presented as a complete
 * one. So the flag travels with the list rather than being inferable from
 * its length.
 */
export interface TraversalResult {
  related: RelatedNode[];
  /** True when the cap stopped the walk, so `related` is a prefix of the answer. */
  truncated: boolean;
  /** The cap that was in force, so a caller can ask again with a larger one. */
  limit: number;
}

export interface NodeNeighbourhood {
  node: GraphNode;
  outgoing: { edge: GraphEdge; node: GraphNode }[];
  incoming: { edge: GraphEdge; node: GraphNode }[];
}

/** Which way an edge was walked to make a hop. */
export type HopDirection = 'forward' | 'backward';

/** Whether a traversal may walk an edge against its direction. */
export type PathDirection = 'outgoing' | 'any';

export interface GraphHop {
  relationship: GraphRelationship;
  /**
   * `backward` means the edge points the other way — a feature IMPLEMENTS a
   * requirement, so reaching the feature *from* the requirement walks that
   * edge in reverse. Recorded rather than smoothed over, because the
   * direction is part of what the relationship means.
   */
  direction: HopDirection;
  /**
   * The edge's own metadata, carried through rather than dropped: the import
   * specifier that was parsed, the foreign key column, the reason the
   * architecture gave for a dependency. It is the answer to "why are these
   * two connected", and the hop is the only place a reader of a trace can
   * be shown it.
   */
  metadata: Record<string, unknown>;
}

/** A chain of nodes, e.g. Component → API → Service → Entity. */
export interface GraphPath {
  nodes: GraphNode[];
  /** One relationship per hop, in order. */
  relationships: GraphRelationship[];
  /** The same hops, each saying which way its edge was walked. */
  hops: GraphHop[];
}

/* ── Impact analysis ──────────────────────────────────────────────────── */

export interface ImpactedNode {
  node: GraphNode;
  depth: number;
  /**
   * The relationship on the edge this node was reached by — the evidence for
   * the claim that it is affected at all. Read with `direction`, it states
   * which end of that edge this node sits at.
   */
  via: GraphRelationship;
  /** Which way the arriving edge was walked, from the changed node's side. */
  direction: HopDirection;
  /**
   * True when a single edge joins this node to the changed one. Then the
   * graph *states* the relationship; at greater depth it is a chain, which
   * is an inference the reader is entitled to see labelled as one.
   */
  direct: boolean;
  /** Why this node is affected, in one line. */
  reason: string;
}

export interface ImpactAnalysis {
  origin: GraphNode;
  impacted: ImpactedNode[];
  /** Counts by type, so "what does this touch?" is answerable at a glance. */
  summary: Partial<Record<GraphNodeType, number>>;
  /** How many of `impacted` the graph joins to the origin by one edge. */
  directCount: number;
  /** How many were reached through a chain, and are therefore inferred. */
  indirectCount: number;
  maxDepth: number;
  /**
   * True when a result cap stopped one of the walks, so `impacted` is a
   * prefix of the real answer. A capped impact answer read as a complete one
   * is how a change ships believing it broke nothing.
   */
  truncated: boolean;
}

/* ── Requirement tracing ──────────────────────────────────────────────── */

/**
 * Which way a trace runs: down from a requirement into the code that
 * implements it, or back up from a file to the requirements it serves.
 */
export type TraceDirection = 'to-implementation' | 'to-requirements';

export interface RequirementTraceLink {
  node: GraphNode;
  depth: number;
  /** True when one edge joins this node to the origin; see `ImpactedNode.direct`. */
  direct: boolean;
  /** The chain of real edges that connects it, each hop carrying its evidence. */
  path: GraphPath;
}

export interface RequirementTrace {
  origin: GraphNode;
  direction: TraceDirection;
  /** What the origin reaches, nearest first. */
  links: RequirementTraceLink[];
  maxDepth: number;
  /** True when the result cap stopped the walk; see `TraversalResult`. */
  truncated: boolean;
}

/* ── Validation ───────────────────────────────────────────────────────── */

/**
 * What a report can say.
 *
 * Every kind here is something this system can actually produce. Three
 * earlier kinds were not: `duplicate-edge` needed two rows the unique index
 * on `(source, target, relationship)` forbids, `invalid-relationship` needed
 * a value outside the enum the column is typed as, and `self-loop` needed an
 * edge the builder refuses to draft. Advertising a check that cannot fire
 * makes a clean report mean less than it appears to, so they are gone rather
 * than kept as reassurance.
 */
export type GraphIssueKind =
  | 'orphan-node'
  | 'dangling-edge'
  | 'suspicious-cycle'
  /** A FEATURE names a requirement no REQUIREMENT node matches. */
  | 'unresolved-requirement-link'
  /** A review agent named a node this graph does not hold. */
  | 'unresolved-finding-target'
  /** A node states a file path that no FILE or TEST node in this graph has. */
  | 'missing-file-reference'
  /** Nodes last written by an earlier run than the project's latest build. */
  | 'stale-node'
  /** The file tree hit the builder's cap, so part of the project is not mapped. */
  | 'truncated-file-tree';

export type GraphIssueSeverity = 'error' | 'warning' | 'info';

export interface GraphIssue {
  kind: GraphIssueKind;
  severity: GraphIssueSeverity;
  message: string;
  /** Nodes the issue concerns, by id. */
  nodeIds: string[];
}

export interface GraphValidationReport {
  valid: boolean;
  checkedNodes: number;
  checkedEdges: number;
  issues: GraphIssue[];
  /**
   * Checks that could not run on this input, so a clean report is not read
   * as "everything was checked". `stale-node` lands here when the caller
   * could not say which run is the project's latest.
   */
  skippedChecks: GraphIssueKind[];
}
