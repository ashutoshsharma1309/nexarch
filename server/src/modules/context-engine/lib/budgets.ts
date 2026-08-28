/**
 * Token budgets, per task.
 *
 * Two independent numbers per task, and keeping them independent is the
 * point. `maxContextTokens` bounds what the engine compiles and sends;
 * `maxOutputTokens` bounds what the model may write back. Conflating them
 * is a classic way to build a system that silently truncates its own
 * answers when the input grows.
 *
 * The context figures are deliberately far below the 131k window the
 * default models offer. A bigger window is not a reason to fill it: every
 * token of irrelevant context costs money, adds latency, and measurably
 * dilutes attention on the tokens that mattered. These are sized to the
 * task, not to the model.
 */
import type { TaskType } from '../context-engine.types.js';

export interface TaskBudget {
  maxContextTokens: number;
  maxOutputTokens: number;
  /** Relevance floor — nodes scoring below this are not worth their tokens. */
  minScore: number;
  /** How far to walk from a target when the caller does not say. */
  defaultDepth: number;
}

const BUDGETS: Record<TaskType, TaskBudget> = {
  // The first stage has no graph to select from — the prompt is the input.
  REQUIREMENT_ANALYSIS: {
    maxContextTokens: 2_000,
    maxOutputTokens: 2_048,
    minScore: 40,
    defaultDepth: 1,
  },
  /**
   * A product spec is modules, journeys, screens and rules in one object —
   * several times the size of a requirement spec. It borrowed the
   * requirement budget at first, and the model's answer was cut off at
   * exactly 2,048 tokens: modules half-formed, journeys and screens empty.
   * A truncated JSON object still parses, so the failure arrived looking
   * like a successful answer — the worst shape available.
   */
  PRODUCT_PLANNING: {
    maxContextTokens: 4_000,
    maxOutputTokens: 6_144,
    minScore: 30,
    defaultDepth: 2,
  },
  ARCHITECTURE_PLANNING: {
    maxContextTokens: 6_000,
    maxOutputTokens: 4_096,
    minScore: 30,
    defaultDepth: 2,
  },
  DATABASE_DESIGN: {
    maxContextTokens: 6_000,
    maxOutputTokens: 4_096,
    minScore: 30,
    defaultDepth: 2,
  },
  BACKEND_GENERATION: {
    maxContextTokens: 8_000,
    maxOutputTokens: 8_192,
    minScore: 30,
    defaultDepth: 2,
  },
  FRONTEND_GENERATION: {
    maxContextTokens: 8_000,
    maxOutputTokens: 8_192,
    minScore: 30,
    defaultDepth: 2,
  },
  SECURITY_REVIEW: {
    maxContextTokens: 6_000,
    maxOutputTokens: 4_096,
    minScore: 30,
    defaultDepth: 2,
  },
  /**
   * The dependency reviewer reads manifests and import lists, not prose.
   * Its context is small because its inputs are: a package.json and the
   * set of modules the source imports fit in very few tokens.
   */
  DEPENDENCY_REVIEW: {
    maxContextTokens: 4_000,
    maxOutputTokens: 2_048,
    minScore: 25,
    defaultDepth: 1,
  },
  /**
   * The quality reviewer needs the shape of the system — modules, services
   * and what they call — more than it needs any one file, so it gets a
   * wider slice at shallow depth.
   */
  QUALITY_REVIEW: {
    maxContextTokens: 8_000,
    maxOutputTokens: 4_096,
    minScore: 25,
    defaultDepth: 2,
  },
  /**
   * A repair reads one finding, one plan and a handful of files. The
   * budget is small because the whole design keeps it small — a repair
   * that needs the wider project in context is a repair that should not
   * be automatic.
   */
  REPAIR: { maxContextTokens: 4_000, maxOutputTokens: 2_048, minScore: 30, defaultDepth: 1 },
  /**
   * Test planning reads the product's own priorities — journeys, modules,
   * requirements — not source. Execution is deterministic and costs no
   * tokens at all; this budget covers only the prioritization pass.
   */
  TEST_PLANNING: {
    maxContextTokens: 4_000,
    maxOutputTokens: 2_048,
    minScore: 25,
    defaultDepth: 1,
  },
  /**
   * The UX reviewer reads screens, not code paths: a wide shallow slice of
   * the component layer rather than a deep walk of one service. Hence the
   * larger context and the depth of 1 — a component's neighbours matter,
   * its neighbours' neighbours do not.
   */
  UX_REVIEW: { maxContextTokens: 6_000, maxOutputTokens: 4_096, minScore: 25, defaultDepth: 1 },
  CODE_REVIEW: { maxContextTokens: 8_000, maxOutputTokens: 4_096, minScore: 30, defaultDepth: 1 },
  IMPACT_EXPLANATION: {
    maxContextTokens: 4_000,
    maxOutputTokens: 2_048,
    minScore: 20,
    defaultDepth: 3,
  },
};

export function budgetFor(task: TaskType): TaskBudget {
  return BUDGETS[task];
}

/**
 * The provider's ceiling on one request.
 *
 * Input budget and output budget are separate numbers with separate
 * meanings — but a provider rate-limits their *sum*. Groq counts
 * `max_completion_tokens` toward the tokens-per-minute allowance before
 * the model writes a single token, so a task budgeting 8,192 output tokens
 * is rejected on an 8,000 TPM tier no matter how small its context is.
 *
 * That is not a reason to conflate the two budgets. It is a reason to
 * clamp them against a declared limit, which is what `fitToProvider` does:
 * the context keeps its ceiling, and the output allowance takes the cut,
 * because a slightly shorter answer beats a rejected request.
 */
const DEFAULT_MAX_REQUEST_TOKENS = 32_000;

import { requestOverheadTokens } from './token-counter.js';

export function maxRequestTokens(): number {
  const raw = process.env.AI_MAX_REQUEST_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUEST_TOKENS;
}

export interface FittedBudget {
  maxContextTokens: number;
  maxOutputTokens: number;
  /** True when the provider limit forced the output allowance down. */
  clamped: boolean;
}

export function fitToProvider(
  maxContextTokens: number,
  maxOutputTokens: number,
  contextTokens: number,
): FittedBudget {
  // A clamp that lands exactly on the limit fails on any variance in the
  // wrapper, and the failure mode is a rejected request rather than a
  // slightly longer answer. Two percent of headroom is cheap insurance.
  const limit = Math.floor(maxRequestTokens() * 0.98);
  // The provider bills the chat wrapper too, and it counts toward the
  // same allowance. Reserving the measured overhead is the difference
  // between a request that fits and one rejected at the edge.
  const room = limit - contextTokens - requestOverheadTokens();

  if (room >= maxOutputTokens) {
    return { maxContextTokens, maxOutputTokens, clamped: false };
  }
  return {
    maxContextTokens,
    // Never below a floor: an output allowance too small to hold an answer
    // is a different failure, not a fix.
    maxOutputTokens: Math.max(512, room),
    clamped: true,
  };
}
