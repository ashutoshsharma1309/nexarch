/**
 * Contracts for the Token & Context Intelligence Engine.
 *
 * The engine answers one question: *what does this AI task actually need to
 * know?* It answers it before the model call, from the Engineering Graph,
 * deterministically — no model is asked to decide its own context, and no
 * scoring rule is anything but arithmetic on graph distance and node type.
 *
 * Two budgets live here and must never be conflated. The **input context
 * budget** bounds what the engine compiles and sends; the **output token
 * limit** bounds what the model is allowed to write back. They are
 * different numbers with different consequences — exceeding the first is a
 * provider rejection, exceeding the second is a truncated answer.
 */
import type {
  ArtifactType,
  GraphNode,
  GraphNodeType,
  TaskType,
} from '../../shared/contracts/index.js';
import type { TokenCountMethod } from './lib/token-counter.js';

/**
 * What the caller is about to do. Drives budgets, node types and artifact
 * needs.
 *
 * Re-exported from the shared contract rather than restated. This file
 * used to carry its own copy of the union, and the two drifted the moment
 * a task type was added for a new agent: the agent declared a context it
 * wanted and the engine did not have a word for it. One definition means
 * that failure is now a compile error at the point of addition.
 */
export type { TaskType } from '../../shared/contracts/index.js';

export const TASK_TYPES: readonly TaskType[] = [
  'REQUIREMENT_ANALYSIS',
  'PRODUCT_PLANNING',
  'ARCHITECTURE_PLANNING',
  'DATABASE_DESIGN',
  'BACKEND_GENERATION',
  'FRONTEND_GENERATION',
  'SECURITY_REVIEW',
  'DEPENDENCY_REVIEW',
  'QUALITY_REVIEW',
  'TEST_PLANNING',
  'REPAIR',
  'UX_REVIEW',
  'CODE_REVIEW',
  'IMPACT_EXPLANATION',
];

/**
 * Selection strategy.
 *
 * `SELECTIVE` is what NexArch runs. `FULL` exists so the two can be
 * measured against each other on the same task — a reduction claim nobody
 * can reproduce is not a result.
 */
export type ContextMode = 'SELECTIVE' | 'FULL';

/**
 * What a caller asks for. Only `projectId` and `taskType` are required;
 * everything else has a task-appropriate default, because a caller that
 * has to specify eleven fields correctly will specify them wrongly.
 */
export interface ContextRequest {
  projectId: string;
  runId?: string;
  taskType: TaskType;
  /** Graph nodes the task is *about*. Empty means project-wide. */
  targetNodeIds?: string[];
  /** Resolve targets by name instead of id — what a caller usually has. */
  targetNames?: string[];
  requiredNodeTypes?: GraphNodeType[];
  requiredArtifactTypes?: ArtifactType[];
  /** Input context ceiling. Defaults to the task's budget. */
  maxTokens?: number;
  includeDependencies?: boolean;
  dependencyDepth?: number;
  includeDependents?: boolean;
  includeSourceFiles?: boolean;
  mode?: ContextMode;
  /** Free-text instruction carried into the compiled context. */
  instruction?: string;
}

/* ── Selection ────────────────────────────────────────────────────────── */

/**
 * Why a node was chosen. Every selection carries one, so a context is
 * explainable after the fact rather than being a black box that happened
 * to work.
 */
export type SelectionReason =
  | 'TARGET'
  | 'DIRECT_DEPENDENCY'
  | 'DIRECT_DEPENDENT'
  | 'TRANSITIVE_DEPENDENCY'
  | 'REQUIRED_NODE_TYPE'
  | 'TASK_RELEVANT_TYPE'
  | 'PROJECT_REQUIREMENT'
  | 'PROJECT_ROOT'
  | 'FULL_MODE';

export type ExclusionReason = 'NOT_RELEVANT' | 'OVER_BUDGET' | 'BELOW_THRESHOLD';

export interface ScoredNode {
  node: GraphNode;
  score: number;
  reason: SelectionReason;
  /** Graph hops from the nearest target. 0 for a target itself. */
  depth: number;
}

export interface ExcludedNode {
  nodeId: string;
  name: string;
  type: GraphNodeType;
  reason: ExclusionReason;
  score: number;
}

/* ── Compilation ──────────────────────────────────────────────────────── */

/** One section of the compiled context, with what it cost. */
export interface ContextSection {
  title: string;
  /** Lower sorts first and survives truncation longer. */
  priority: number;
  content: string;
  tokens: number;
  /** Artifact this section was derived from, where it came from one. */
  sourceArtifact: ArtifactType | null;
}

export interface CompiledContext {
  projectId: string;
  runId: string | null;
  taskType: TaskType;
  mode: ContextMode;
  /** The text actually sent to the model. */
  text: string;
  /** The same content as data, for callers that want to inspect it. */
  sections: ContextSection[];
  tokens: number;
  tokenMethod: TokenCountMethod;
  tokensAreExact: boolean;
  budget: TokenBudgetReport;
  trace: ContextTrace;
}

export interface TokenBudgetReport {
  /** Ceiling for the compiled input context. */
  maxContextTokens: number;
  usedContextTokens: number;
  /** Separate ceiling for what the model may write back. Never mixed with the above. */
  maxOutputTokens: number;
  withinBudget: boolean;
}

/**
 * The audit record. Answers "why was this context selected?" without
 * re-running the selection.
 */
export interface ContextTrace {
  selected: {
    nodeId: string;
    name: string;
    type: GraphNodeType;
    reason: SelectionReason;
    score: number;
    depth: number;
  }[];
  excluded: ExcludedNode[];
  artifactsIncluded: ArtifactType[];
  artifactsExcluded: {
    type: ArtifactType;
    reason: 'not-relevant' | 'unavailable' | 'over-budget';
  }[];
  /** Sections dropped to fit the budget, in the order they were dropped. */
  truncatedSections: { title: string; tokens: number }[];
  compression: { applied: string[]; tokensSaved: number };
  sanitization: { redactions: number; kinds: string[] };
  cache: 'hit' | 'miss' | 'bypass';
  graphNodesConsidered: number;
  durationMs: number;
}

/* ── Benchmark ────────────────────────────────────────────────────────── */

export interface BenchmarkArm {
  mode: ContextMode;
  contextTokens: number;
  contextChars: number;
  selectedNodes: number;
  selectedArtifacts: number;
  /** Present only when the arm actually called a model. */
  call: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
    costUsd: number;
    /** Whether the model returned output that satisfied the task's schema. */
    outputValid: boolean;
  } | null;
}

export interface BenchmarkResult {
  taskType: TaskType;
  projectId: string;
  full: BenchmarkArm;
  selective: BenchmarkArm;
  /** ((full - selective) / full) × 100, on input context tokens. */
  contextReductionPercent: number;
  totalTokenReductionPercent: number | null;
  measuredAt: string;
}
