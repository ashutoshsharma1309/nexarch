/**
 * Deterministic relevance scoring.
 *
 * Arithmetic on graph distance and node type — no model is consulted, and
 * the same request against the same graph always produces the same
 * selection. That is not a limitation to be lifted later: a context
 * selector that is itself non-deterministic makes every downstream failure
 * unreproducible.
 *
 * Scores are additive so a node can qualify several ways, and each node
 * keeps the single strongest *reason* for the trace. Reason and score are
 * separate on purpose: the score decides what fits in the budget, the
 * reason explains the decision to a person.
 */
import type { GraphNode, GraphNodeType } from '../../../shared/contracts/index.js';
import type { SelectionReason, TaskType } from '../context-engine.types.js';

export const SCORE = {
  TARGET: 100,
  DIRECT_DEPENDENCY: 80,
  DIRECT_DEPENDENT: 60,
  REQUIRED_NODE_TYPE: 50,
  TASK_RELEVANT_TYPE: 50,
  RELATED_ARTIFACT: 40,
  SAME_MODULE: 30,
  PROJECT_REQUIREMENT: 20,
  UNRELATED: 0,
} as const;

/** Decay per extra hop, so a transitive dependency outranks a distant one. */
const DEPTH_DECAY = 0.55;

/**
 * Which node types each task actually reasons over.
 *
 * Backend generation cares about services, endpoints and entities; it does
 * not care about frontend pages or npm packages. Encoding that here is
 * what stops "everything in the project" from being the answer.
 */
const TASK_TYPES: Record<TaskType, GraphNodeType[]> = {
  REQUIREMENT_ANALYSIS: ['REQUIREMENT', 'FEATURE', 'PROJECT'],
  PRODUCT_PLANNING: ['REQUIREMENT', 'FEATURE', 'COMPONENT', 'PROJECT'],
  ARCHITECTURE_PLANNING: ['REQUIREMENT', 'FEATURE', 'MODULE', 'SERVICE', 'API', 'ENTITY'],
  DATABASE_DESIGN: ['ENTITY', 'FIELD', 'SERVICE', 'REQUIREMENT'],
  BACKEND_GENERATION: ['SERVICE', 'MODULE', 'API', 'ENTITY', 'FIELD', 'REQUIREMENT'],
  FRONTEND_GENERATION: ['COMPONENT', 'API', 'ENTITY', 'FEATURE', 'REQUIREMENT'],
  SECURITY_REVIEW: ['SECURITY_RULE', 'API', 'ENTITY', 'SERVICE'],
  DEPENDENCY_REVIEW: ['DEPENDENCY', 'MODULE', 'FILE'],
  QUALITY_REVIEW: ['SERVICE', 'MODULE', 'FILE', 'COMPONENT', 'API', 'ENTITY'],
  TEST_PLANNING: ['FEATURE', 'REQUIREMENT', 'API', 'ENTITY'],
  REPAIR: ['FILE', 'API', 'SERVICE', 'MODULE', 'COMPONENT'],
  UX_REVIEW: ['COMPONENT', 'FEATURE', 'REQUIREMENT', 'API'],
  CODE_REVIEW: ['FILE', 'TEST', 'MODULE', 'SERVICE'],
  IMPACT_EXPLANATION: ['SERVICE', 'MODULE', 'API', 'ENTITY', 'COMPONENT', 'FILE'],
};

export function taskNodeTypes(task: TaskType): GraphNodeType[] {
  return TASK_TYPES[task];
}

export interface ScoreInput {
  node: GraphNode;
  /** Hops from the nearest target; 0 for a target. */
  depth: number;
  isTarget: boolean;
  isDirectDependency: boolean;
  isDirectDependent: boolean;
  /** Shares a module (or feature) with a target. */
  sharesModule: boolean;
  task: TaskType;
  requiredTypes: GraphNodeType[];
}

export interface Scored {
  score: number;
  reason: SelectionReason;
}

export function scoreNode(input: ScoreInput): Scored {
  if (input.isTarget) return { score: SCORE.TARGET, reason: 'TARGET' };

  let score = 0;
  // The strongest applicable reason wins the label, in this order.
  let reason: SelectionReason = 'TASK_RELEVANT_TYPE';

  if (input.isDirectDependency) {
    score += SCORE.DIRECT_DEPENDENCY;
    reason = 'DIRECT_DEPENDENCY';
  } else if (input.isDirectDependent) {
    score += SCORE.DIRECT_DEPENDENT;
    reason = 'DIRECT_DEPENDENT';
  } else if (input.depth > 1) {
    // Reached only by walking further; worth less the further it is.
    score += SCORE.DIRECT_DEPENDENCY * Math.pow(DEPTH_DECAY, input.depth - 1);
    reason = 'TRANSITIVE_DEPENDENCY';
  }

  if (input.requiredTypes.includes(input.node.type)) {
    score += SCORE.REQUIRED_NODE_TYPE;
    if (score === SCORE.REQUIRED_NODE_TYPE) reason = 'REQUIRED_NODE_TYPE';
  } else if (TASK_TYPES[input.task].includes(input.node.type)) {
    score += SCORE.TASK_RELEVANT_TYPE;
  }

  if (input.sharesModule) score += SCORE.SAME_MODULE;

  // A project's stated requirements are cheap and almost always worth
  // carrying — they are why the code exists.
  if (input.node.type === 'REQUIREMENT') {
    score += SCORE.PROJECT_REQUIREMENT;
    if (reason === 'TASK_RELEVANT_TYPE') reason = 'PROJECT_REQUIREMENT';
  }
  if (input.node.type === 'PROJECT') {
    score += SCORE.PROJECT_REQUIREMENT;
    reason = 'PROJECT_ROOT';
  }

  return { score: Math.round(score), reason };
}
