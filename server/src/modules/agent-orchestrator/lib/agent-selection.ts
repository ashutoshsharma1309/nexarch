/**
 * Which planned agents this product actually calls for.
 *
 * The product decision is the create path's own `decideProduct`, read from the
 * user's words, so the two paths cannot disagree about what was asked for. An
 * agent is dropped only on a positive reason. Anything ambiguous runs, because
 * an unneeded agent costs a little time and a wrongly skipped one costs a check
 * nobody knows is missing.
 *
 * A skip is a recorded fact with its reason. It never reads as a completed
 * task, and a caller who named specific agents keeps all of them.
 */
import { config } from '../../../shared/config/index.js';
import { decideProduct } from '../../pipeline/lib/product-decision.js';
import { publishForRun, meshStageOf } from './execution-publisher.js';
import { recordEvent, touch } from './run-store.js';
import type { ProductDecision } from '../../pipeline/lib/product-decision.js';
import type { AgentId } from '../../../shared/contracts/index.js';
import type { AgentRun } from '../agent-orchestrator.types.js';

export interface SkipDecision {
  agentId: AgentId;
  reason: string;
}

const NO_RESEARCH = /\b(no|skip|without|don'?t (do|run|use)|avoid)\s+(any\s+)?(web\s+)?research\b/i;
const API_ONLY =
  /\b(api[- ]only|headless|backend[- ]only|no\s+(ui|frontend|front[- ]end|user interface))\b/i;

export function productDecisionFor(prompt: string): ProductDecision {
  return decideProduct(prompt, { appAuthEnabled: config.generation.appAuth });
}

/** True when the person said there is no interface to design. */
export function isApiOnlyRequest(prompt: string): boolean {
  return API_ONLY.test(prompt);
}

export function decideSkips(prompt: string): SkipDecision[] {
  const skips: SkipDecision[] = [];

  if (NO_RESEARCH.test(prompt)) {
    skips.push({ agentId: 'research-agent', reason: 'The request says not to do web research.' });
  }
  if (isApiOnlyRequest(prompt)) {
    skips.push({
      agentId: 'design-intelligence',
      reason: 'The request is for an API with no interface, so no site design was written.',
    });
  }
  if (!productDecisionFor(prompt).backend) {
    const reason =
      'The product decision is a website with no application behind it, so API, auth and data-flow checks do not apply. Build and startup are still checked.';
    skips.push({ agentId: 'integration-engineer', reason });
    skips.push({ agentId: 'test-engineer', reason });
  }
  return skips;
}

/** Marks ruled-out tasks SKIPPED. Tasks that already ran are left alone. */
export function applyAgentSelection(run: AgentRun): SkipDecision[] {
  if (run.explicitAgents) return [];

  const applied: SkipDecision[] = [];
  for (const skip of decideSkips(run.prompt)) {
    const task = run.tasks.find((entry) => entry.agentId === skip.agentId);
    if (!task || !['PENDING', 'READY', 'BLOCKED'].includes(task.status)) continue;

    task.status = 'SKIPPED';
    task.skipReason = skip.reason;
    task.summary = skip.reason;
    recordEvent(run.id, 'AGENT_SKIPPED', {
      taskId: task.id,
      agentId: task.agentId,
      detail: { reason: skip.reason },
    });
    publishForRun(run, {
      type: 'stage.skipped',
      status: 'skipped',
      stage: meshStageOf(task.agentId),
      agentId: task.agentId,
      message: skip.reason,
      data: { reason: skip.reason },
    });
    applied.push(skip);
  }
  if (applied.length > 0) touch(run);
  return applied;
}
