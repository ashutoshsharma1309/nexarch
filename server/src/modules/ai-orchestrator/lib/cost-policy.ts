/**
 * Which class of model a piece of work deserves, and how much failure it may
 * buy before giving up.
 *
 * The caller's `complexity` is a statement about the shape of the call, and
 * several callers chose it for token budget reasons: `site-design` asks for
 * `simple-extraction` and sets its own output ceiling, which put the page's
 * whole visual direction on the cheapest model. Keying the exceptions by
 * prompt keeps that decision in one table instead of across six modules.
 *
 * Only the route changes. Output ceilings still come from the caller, because
 * a free-tier provider counts the allowance against its per-minute budget
 * before generating and a larger allowance is a 429 rather than a better answer.
 */
import type { GenerateRequest, TaskComplexity } from '../ai-orchestrator.types.js';

type ReasoningEffort = 'low' | 'medium' | 'high';

interface PromptPolicy {
  complexity: TaskComplexity;
  /** Overrides the effort the requested complexity would have used. */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Prompts that always belong on one tier, whatever the call site asked for.
 *
 * Design runs at `medium`: on a model that reasons out of its answer budget,
 * the provider's default effort can exhaust a 5,120-token ceiling mid-object.
 */
const PROMPT_POLICY: Readonly<Record<string, PromptPolicy>> = {
  // Architecture and design: mistakes here are paid for by every later stage.
  'architecture-planner': { complexity: 'large-planning' },
  'product-architect': { complexity: 'large-planning' },
  'site-design': { complexity: 'large-planning', reasoningEffort: 'medium' },
  'edit-site-design': { complexity: 'large-planning', reasoningEffort: 'medium' },
  // Classification and extraction: the answer is already in the input.
  'requirement-analyzer': { complexity: 'simple-extraction' },
};

/**
 * A repair prompt starts cheap, because most failures are one wrong import.
 * Being asked again within the same job is the evidence that it was not.
 */
const ESCALATING_PROMPTS = new Set(['repair-engineer']);

/**
 * Total provider calls one `generate()` may make across retries and failover.
 *
 * Without this the bound is attempts times chain length: three tries on five
 * providers, at up to 60s each, for a single classification. Three tries each
 * on two providers is enough to ride out a real outage; deep work gets a
 * third provider because a failure there costs far more than the retry.
 */
const MAX_PROVIDER_CALLS: Readonly<Record<TaskComplexity, number>> = {
  'simple-extraction': 6,
  'small-file-regen': 6,
  'vision-analysis': 6,
  'large-planning': 9,
  'complex-refactor': 9,
  'research-synthesis': 9,
};

export interface CallPolicy {
  /** The route to use, which may differ from the one requested. */
  complexity: TaskComplexity;
  /** Set only when the policy overrides the effort for this complexity. */
  reasoningEffort?: ReasoningEffort;
  maxProviderCalls: number;
}

export function resolveCallPolicy(
  promptId: string,
  requested: GenerateRequest['complexity'],
  /** How many times this prompt has already run in this job. */
  priorCallsInJob: number,
): CallPolicy {
  const fixed = PROMPT_POLICY[promptId];
  const complexity =
    fixed?.complexity ??
    (ESCALATING_PROMPTS.has(promptId) && priorCallsInJob > 0 ? 'complex-refactor' : requested);
  return {
    complexity,
    ...(fixed?.reasoningEffort === undefined ? {} : { reasoningEffort: fixed.reasoningEffort }),
    maxProviderCalls: MAX_PROVIDER_CALLS[complexity],
  };
}
