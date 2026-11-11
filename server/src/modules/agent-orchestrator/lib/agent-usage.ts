/**
 * Turns what a stage measured into the agent contract's usage shape.
 *
 * Null stays null all the way through: an agent that made no model call has
 * no usage, and reporting zero tokens for it would claim a measurement.
 */
import type { AgentUsage } from '../../../shared/contracts/index.js';

export interface MeasuredCall {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Null when the model has no published price. */
  knownCostUsd?: number | null;
}

/** Marks a usage record whose cost figure leaves out an unpriced call. */
export function unpriced(cost: number | null | undefined): { unpricedCalls?: number } {
  return cost === null || cost === undefined ? { unpricedCalls: 1 } : {};
}

export function toAgentUsage(call: MeasuredCall | null, contextTokens = 0): AgentUsage | null {
  if (!call) return null;
  const { knownCostUsd, ...measured } = call;
  return {
    ...measured,
    contextTokens,
    ...('knownCostUsd' in call ? unpriced(knownCostUsd) : {}),
  };
}

/**
 * Adds several calls into one usage record.
 *
 * Provider and model name the last call, the one whose output was kept or
 * last tried; the token counts cover every call that was really made.
 */
export function sumUsage(calls: readonly (AgentUsage | null)[]): AgentUsage | null {
  const made = calls.filter((call): call is AgentUsage => call !== null);
  const last = made.at(-1);
  if (!last) return null;
  const unpricedCalls = made.reduce((sum, call) => sum + (call.unpricedCalls ?? 0), 0);
  return {
    provider: last.provider,
    model: last.model,
    inputTokens: made.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: made.reduce((sum, call) => sum + call.outputTokens, 0),
    costUsd: Number(made.reduce((sum, call) => sum + call.costUsd, 0).toFixed(6)),
    contextTokens: made.reduce((sum, call) => sum + call.contextTokens, 0),
    ...(unpricedCalls > 0 ? { unpricedCalls } : {}),
  };
}
