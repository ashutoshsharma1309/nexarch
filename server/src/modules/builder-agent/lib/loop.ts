/**
 * The Builder Agent's execution loop.
 *
 *   decide → validate → act (independent actions in parallel) → record → repeat
 *
 * Each turn the model (or, when it is unavailable or unusable, the
 * deterministic policy) chooses one to three actions; they run concurrently;
 * every action becomes a recorded step the UI shows as it happens. The loop
 * ends on `finish`, on cancellation, or at its step and time limits.
 *
 * Success is not the model's to claim. A `finish` before the website is
 * built, running and inspected is refused once and the policy continues; the
 * session is `succeeded` only when that evidence exists — and only when
 * validation did not come back against it — whatever the final summary says.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../../shared/logger/index.js';
import type { ValidationGate } from '../../../shared/types/validation.js';
import type {
  BuilderSession,
  BuilderStep,
  BuilderToolName,
  DecisionSource,
} from '../builder-agent.types.js';
import type { DecideOutcome } from './decider.js';
import { policyDecision } from './policy.js';
import type { Decision, PlannedAction } from './policy.js';
import type { BuilderTool, ToolContext, ToolResult } from './tools.js';

export interface LoopDeps {
  /** The model's decision; `null` when no model is available. */
  decide:
    ((session: BuilderSession, step: number, maxSteps: number) => Promise<DecideOutcome>) | null;
  tool: (name: string) => BuilderTool | undefined;
  runTool: (tool: BuilderTool, ctx: ToolContext, args: unknown) => Promise<ToolResult>;
  ownerId: string;
  isCancelled: () => boolean;
  limits?: Partial<LoopLimits>;
  /** Called whenever the session changed, e.g. to persist or log. */
  onChange?: (session: BuilderSession) => void;
}

export interface LoopLimits {
  maxDecisions: number;
  maxDurationMs: number;
  /** Consecutive unusable model answers before the policy takes over for good. */
  maxModelFailures: number;
}

const DEFAULT_LIMITS: LoopLimits = {
  maxDecisions: 14,
  maxDurationMs: 45 * 60_000,
  maxModelFailures: 3,
};

/**
 * Tools that consume another tool's output come after it. Actions of the same
 * stage are independent and run together; stages run in order.
 */
const STAGES: Record<BuilderToolName, number> = {
  create_project: 0,
  build_app: 1,
  list_files: 2,
  read_file: 2,
  preview_app: 2,
  review_app: 2,
  repair_app: 3,
  inspect_website: 3,
  finish: 4,
};

export function stageOf(tool: BuilderToolName): number {
  return STAGES[tool];
}

/**
 * The gate values that mean validation did not hold: `FAILED` is a check that
 * ran and failed, `BLOCKED` one that could not run at all. Both are evidence
 * against the website, so neither may complete a session — without this a
 * build that ran and answered HTTP was reported as `succeeded` while its own
 * validation said the app was broken.
 */
const FAILING_GATES: readonly ValidationGate[] = ['FAILED', 'BLOCKED'];

/** The failing gate the session recorded, or `null` when the gate is not one. */
function failingGate(state: BuilderSession['state']): string | null {
  const gate = state.validationGate;
  if (gate === null) return null;
  return FAILING_GATES.some((failing) => failing === gate) ? gate : null;
}

export function isComplete(session: BuilderSession): boolean {
  const { state } = session;
  return (
    state.pipelineRunId !== null &&
    state.frontendUrl !== null &&
    state.inspected &&
    failingGate(state) === null
  );
}

function now(): string {
  return new Date().toISOString();
}

function addStep(
  session: BuilderSession,
  fields: Pick<BuilderStep, 'kind' | 'by' | 'summary'> & Partial<BuilderStep>,
): BuilderStep {
  const step: BuilderStep = {
    id: randomUUID(),
    index: session.steps.length + 1,
    tool: null,
    args: null,
    status: 'ok',
    detail: null,
    startedAt: now(),
    completedAt: now(),
    durationMs: 0,
    ...fields,
  };
  session.steps.push(step);
  session.updatedAt = now();
  return step;
}

function composeSummary(session: BuilderSession): string {
  const { state } = session;
  if (isComplete(session)) {
    const sections = state.landingSections.join(', ') || 'no landing sections';
    return `Built "${state.projectName ?? 'the website'}" and it is running at ${state.frontendUrl ?? ''}. Landing page: ${sections}. Validation gate: ${state.validationGate ?? 'not run'}.`;
  }
  // A failed gate leaves no failed step behind — the review tool itself
  // succeeded in reporting it — so the gate has to speak for itself here.
  const gate = failingGate(state);
  if (gate !== null) {
    const where =
      state.frontendUrl === null
        ? 'The website was built but never started'
        : `The website is running at ${state.frontendUrl}`;
    return `${where}, and its validation gate came back ${gate} — it is not fit to hand over.`;
  }
  const last = [...session.steps].reverse().find((step) => step.status === 'failed');
  return `The website was not completed${last ? `: ${last.tool ?? last.kind} — ${last.summary}` : '.'}`;
}

async function executeAction(
  session: BuilderSession,
  deps: LoopDeps,
  action: PlannedAction,
  by: DecisionSource,
): Promise<void> {
  const tool = deps.tool(action.tool);
  const step = addStep(session, {
    kind: 'tool',
    by,
    tool: action.tool,
    args: action.args,
    status: 'running',
    summary: `Running ${action.tool}…`,
    completedAt: null,
    durationMs: null,
  });
  deps.onChange?.(session);
  const started = Date.now();

  const result: ToolResult = tool
    ? await deps.runTool(
        tool,
        { ownerId: deps.ownerId, session, isCancelled: deps.isCancelled },
        action.args,
      )
    : { ok: false, summary: `Unknown tool ${action.tool}` };

  step.status = result.ok ? 'ok' : 'failed';
  step.summary = result.summary;
  step.detail = result.detail ?? null;
  step.completedAt = now();
  step.durationMs = Date.now() - started;
  session.updatedAt = now();
  logger.info('builder agent step', {
    sessionId: session.id,
    tool: action.tool,
    by,
    ok: result.ok,
    durationMs: step.durationMs,
  });
  deps.onChange?.(session);
}

export async function runLoop(session: BuilderSession, deps: LoopDeps): Promise<void> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const startedAt = Date.now();
  let modelFailures = 0;
  let finishRefused = false;

  try {
    for (let turn = 1; turn <= limits.maxDecisions; turn += 1) {
      if (deps.isCancelled()) {
        session.status = 'cancelled';
        break;
      }
      if (Date.now() - startedAt > limits.maxDurationMs) {
        addStep(session, {
          kind: 'note',
          by: 'policy',
          status: 'failed',
          summary: 'Time limit reached.',
        });
        break;
      }

      /* ── Decide ─────────────────────────────────────────────────────── */

      let decision: Decision | null = null;
      let by: DecisionSource = 'policy';
      if (deps.decide && modelFailures < limits.maxModelFailures) {
        const outcome = await deps.decide(session, turn, limits.maxDecisions);
        if (outcome.usage) {
          session.usage.inputTokens += outcome.usage.inputTokens;
          session.usage.outputTokens += outcome.usage.outputTokens;
          session.usage.costUsd = Number(
            (session.usage.costUsd + outcome.usage.costUsd).toFixed(6),
          );
        }
        if (outcome.decision) {
          decision = outcome.decision;
          by = 'model';
          modelFailures = 0;
        } else {
          modelFailures += 1;
          addStep(session, {
            kind: 'note',
            by: 'policy',
            status: 'failed',
            summary: `Model decision unusable (${outcome.error ?? 'no answer'}) — the policy takes this step.`,
          });
        }
      }
      decision ??= policyDecision(session);

      // A finish without evidence is refused once; the policy knows what is missing.
      if (
        decision.actions.some((action) => action.tool === 'finish') &&
        !isComplete(session) &&
        !finishRefused
      ) {
        const next = policyDecision(session);
        if (!next.actions.some((action) => action.tool === 'finish')) {
          finishRefused = true;
          addStep(session, {
            kind: 'note',
            by: 'policy',
            summary: 'Finish refused: the website is not yet built, running and inspected.',
          });
          decision = next;
          by = 'policy';
        }
      }

      session.usage.decisions += 1;
      if (by === 'model') session.usage.modelDecisions += 1;
      else session.usage.policyDecisions += 1;
      if (session.plan.length === 0 && decision.plan.length > 0) session.plan = decision.plan;

      addStep(session, {
        kind: 'decision',
        by,
        summary: decision.thought || `Next: ${decision.actions.map((a) => a.tool).join(', ')}`,
        detail: { actions: decision.actions.map((action) => action.tool) },
      });
      deps.onChange?.(session);

      /* ── Act ────────────────────────────────────────────────────────── */

      const finish = decision.actions.find((action) => action.tool === 'finish');
      const work = decision.actions.filter((action) => action.tool !== 'finish');
      // Parallel only within a stage: a preview grouped with the build that
      // produces it must wait for that build, whatever the decision said.
      for (const stage of [...new Set(work.map((action) => stageOf(action.tool)))].sort()) {
        if (deps.isCancelled()) break;
        await Promise.all(
          work
            .filter((action) => stageOf(action.tool) === stage)
            .map((action) => executeAction(session, deps, action, by)),
        );
      }

      if (finish) {
        session.result = {
          complete: isComplete(session),
          summary: decision.summary.trim() || composeSummary(session),
          projectId: session.state.projectId,
          frontendUrl: session.state.frontendUrl,
          backendUrl: session.state.backendUrl,
          validationGate: session.state.validationGate,
          landingSections: session.state.landingSections,
        };
        break;
      }
    }
  } catch (error) {
    session.error = error instanceof Error ? error.message : String(error);
    logger.error('builder agent loop failed', { sessionId: session.id, error: session.error });
  }

  // The evidence decides the outcome — never the summary.
  session.result ??= {
    complete: isComplete(session),
    summary: composeSummary(session),
    projectId: session.state.projectId,
    frontendUrl: session.state.frontendUrl,
    backendUrl: session.state.backendUrl,
    validationGate: session.state.validationGate,
    landingSections: session.state.landingSections,
  };
  // The model writes the summary only when the evidence backs it. Matching a
  // "Built …" prefix was not enough: any other wording of the same claim
  // ("All built and live at …") survived onto an incomplete session.
  if (!session.result.complete) {
    session.result.summary = composeSummary(session);
  }
  if (session.status !== 'cancelled') {
    session.status = isComplete(session) ? 'succeeded' : 'failed';
  }
  session.updatedAt = now();
  deps.onChange?.(session);
}
