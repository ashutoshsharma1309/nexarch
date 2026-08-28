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
  runId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  generatedAt: string;
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

export interface NodeNeighbourhood {
  node: GraphNode;
  outgoing: { edge: GraphEdge; node: GraphNode }[];
  incoming: { edge: GraphEdge; node: GraphNode }[];
}

/** A directed chain of nodes, e.g. Component → API → Service → Entity. */
export interface GraphPath {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}

/* ── Impact analysis ──────────────────────────────────────────────────── */

export interface ImpactedNode {
  node: GraphNode;
  depth: number;
  via: GraphRelationship;
  /** Why this node is affected, in one line. */
  reason: string;
}

export interface ImpactAnalysis {
  origin: GraphNode;
  impacted: ImpactedNode[];
  /** Counts by type, so "what does this touch?" is answerable at a glance. */
  summary: Partial<Record<GraphNodeType, number>>;
  maxDepth: number;
}

/* ── Validation ───────────────────────────────────────────────────────── */

export type GraphIssueKind =
  | 'orphan-node'
  | 'dangling-edge'
  | 'duplicate-edge'
  | 'invalid-relationship'
  | 'self-loop'
  | 'suspicious-cycle';

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
}
