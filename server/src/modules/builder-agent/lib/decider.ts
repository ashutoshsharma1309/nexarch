/**
 * The model's side of the loop: one call per decision, through the platform's
 * AI orchestrator (so routing, retries, rate-limit backoff, cost accounting
 * and generation history all apply), answered as one validated JSON object.
 *
 * Context is deliberately small. The model sees the task, the tool catalogue,
 * the session's state and a one-line summary of each recent step — never
 * artifacts, source files or logs. Tools return rich detail to the UI; only
 * their summaries come back to the model.
 */
import { z } from 'zod';

import { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { aiConfigured } from '../../pipeline/lib/ai-stages.js';
import type { BuilderSession } from '../builder-agent.types.js';
import type { Decision } from './policy.js';
import { describeTools, toolByName } from './tools.js';

const HISTORY_STEPS = 10;

const decisionSchema = z.object({
  thought: z.string().max(1_000).default(''),
  plan: z.array(z.string().max(200)).max(8).default([]),
  actions: z
    .array(z.object({ tool: z.string(), args: z.record(z.unknown()).default({}) }))
    .min(1)
    .max(3),
  summary: z.string().max(1_500).default(''),
});

export interface DecideOutcome {
  decision: Decision | null;
  /** Why the model's answer was not used — recorded, and fed back next turn. */
  error: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number } | null;
}

export function historyOf(session: BuilderSession): string {
  const lines = session.steps
    .filter((step) => step.kind !== 'decision')
    .slice(-HISTORY_STEPS)
    .map((step) => {
      const label = step.tool ?? step.kind;
      return `#${String(step.index)} ${label} → ${step.status}: ${step.summary.slice(0, 240)}`;
    });
  return lines.length > 0 ? lines.join('\n') : '(nothing yet)';
}

export function stateOf(session: BuilderSession): string {
  const { state } = session;
  return JSON.stringify({
    project: state.projectName,
    built: state.pipelineRunId !== null,
    buildUsedFallbacks: state.buildDegraded,
    previewRunning: state.frontendUrl !== null,
    reviewed: state.agentRunId !== null,
    validationGate: state.validationGate,
    repaired: state.repaired,
    inspected: state.inspected,
    landingSections: state.landingSections,
  });
}

export function modelAvailable(): boolean {
  return aiConfigured();
}

export async function decideWithModel(
  session: BuilderSession,
  step: number,
  maxSteps: number,
): Promise<DecideOutcome> {
  let usage: DecideOutcome['usage'] = null;
  try {
    const response = await generate(
      {
        promptId: 'builder-agent',
        variables: {
          TASK: session.task,
          TOOLS: describeTools(),
          STATE: stateOf(session),
          HISTORY: historyOf(session),
          STEP: `${String(step)} of at most ${String(maxSteps)}`,
        },
        complexity: 'simple-extraction',
        schema: 'generic-json',
      },
      { maxOutputTokens: 2_048 },
    );
    usage = {
      inputTokens: response.record.tokens.inputTokens,
      outputTokens: response.record.tokens.outputTokens,
      // Null when the model has no published price; it adds nothing to the
      // money total, and the AI analytics counts those calls separately.
      costUsd: response.record.cost.totalCostUsd ?? 0,
    };

    const parsed = decisionSchema.safeParse(JSON.parse(response.content));
    if (!parsed.success) {
      return {
        decision: null,
        error: `The decision did not match the contract: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        usage,
      };
    }
    const unknown = parsed.data.actions.filter((action) => !toolByName(action.tool));
    if (unknown.length > 0) {
      return {
        decision: null,
        error: `Unknown tool(s): ${unknown.map((action) => action.tool).join(', ')}`,
        usage,
      };
    }
    return {
      decision: {
        thought: parsed.data.thought,
        plan: parsed.data.plan,
        actions: parsed.data.actions.map((action) => ({
          tool: action.tool as Decision['actions'][number]['tool'],
          args: action.args,
        })),
        summary: parsed.data.summary,
      },
      error: null,
      usage,
    };
  } catch (error) {
    return { decision: null, error: error instanceof Error ? error.message : String(error), usage };
  }
}
