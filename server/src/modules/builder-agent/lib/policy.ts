/**
 * The deterministic policy: what a careful engineer would do next, given only
 * the session's state. It stands in for the model when no model is
 * configured, when the model's answer is unusable, and as the reference
 * the model's own choices are measured against.
 */
import { deriveProjectName } from '../../pipeline/lib/ai-stages.js';
import type { BuilderSession, BuilderToolName } from '../builder-agent.types.js';

export interface PlannedAction {
  tool: BuilderToolName;
  args: Record<string, unknown>;
}

export interface Decision {
  thought: string;
  plan: string[];
  actions: PlannedAction[];
  summary: string;
}

export const DEFAULT_PLAN = [
  'Create a project for the website',
  'Generate the application and its landing page',
  'Start a live preview and run the 14-agent review in parallel',
  'Inspect the running website',
  'Report what was built and where to open it',
];

/** "…a company called NovaStack…" → "NovaStack"; otherwise a short name from the task. */
export function projectNameFor(task: string): string {
  // Up to three capitalised words; a period ends the name ("…called NovaStack. Include…").
  const named = /\b(?:called|named)\s+["“']?([A-Z][\w&-]*(?:[ \t]+[A-Z][\w&-]*){0,2})/.exec(task);
  const name = named?.[1]?.replace(/[.,;:!?]+$/, '') ?? deriveProjectName(task);
  return name.slice(0, 60);
}

/** How often a tool has been tried, and how often it failed. */
export function attemptsOf(
  session: BuilderSession,
  tool: BuilderToolName,
): { tried: number; failed: number } {
  const steps = session.steps.filter((step) => step.kind === 'tool' && step.tool === tool);
  return { tried: steps.length, failed: steps.filter((step) => step.status === 'failed').length };
}

export function policyDecision(session: BuilderSession): Decision {
  const { state } = session;
  const first = session.steps.length === 0;
  const plan = first ? DEFAULT_PLAN : [];

  if (!state.projectId) {
    return {
      thought: 'Nothing exists yet; the website needs a project to live in.',
      plan,
      actions: [{ tool: 'create_project', args: { name: projectNameFor(session.task) } }],
      summary: '',
    };
  }

  // Built means a build succeeded, not merely that one was started.
  const build = attemptsOf(session, 'build_app');
  const built = build.tried > build.failed;
  if (!built) {
    if (build.tried < 2) {
      return {
        thought: 'The project exists; generate the application and its landing page.',
        plan,
        actions: [{ tool: 'build_app', args: { prompt: session.task } }],
        summary: '',
      };
    }
    return {
      thought: 'The build failed twice; there is nothing to preview.',
      plan,
      actions: [{ tool: 'finish', args: {} }],
      summary: '',
    };
  }

  const actions: PlannedAction[] = [];
  const preview = attemptsOf(session, 'preview_app');
  if (!state.frontendUrl && preview.tried < 2) {
    actions.push({ tool: 'preview_app', args: {} });
  }
  if (!state.agentRunId) {
    actions.push({ tool: 'review_app', args: {} });
  }
  if (actions.length > 0) {
    return {
      thought:
        actions.length > 1
          ? 'Preview and review are independent — run them together.'
          : `Next: ${actions[0]?.tool ?? ''}.`,
      plan,
      actions,
      summary: '',
    };
  }

  const inspect = attemptsOf(session, 'inspect_website');
  if (state.frontendUrl && !state.inspected && inspect.tried < 2) {
    return {
      thought: 'The website is running; check it the way a visitor would.',
      plan,
      actions: [{ tool: 'inspect_website', args: {} }],
      summary: '',
    };
  }

  return {
    thought: 'Nothing further would change the outcome.',
    plan,
    actions: [{ tool: 'finish', args: {} }],
    summary: '',
  };
}
