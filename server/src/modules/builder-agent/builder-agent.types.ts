/**
 * The Builder Agent's session: one task from a user, carried to a running
 * website by an orchestrator that delegates to the platform's own systems.
 */

export type BuilderToolName =
  | 'create_project'
  | 'build_app'
  | 'review_app'
  | 'repair_app'
  | 'preview_app'
  | 'inspect_website'
  | 'list_files'
  | 'read_file'
  | 'finish';

export type BuilderStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Who chose an action: the model, or the deterministic policy standing in for it. */
export type DecisionSource = 'model' | 'policy';

export interface BuilderStep {
  id: string;
  index: number;
  kind: 'decision' | 'tool' | 'note';
  by: DecisionSource;
  tool: BuilderToolName | null;
  args: Record<string, unknown> | null;
  status: 'running' | 'ok' | 'failed';
  /** One line a user can read. */
  summary: string;
  /** Structured result for the UI; never secrets, never whole files. */
  detail: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

/** What the session has established — the orchestrator's working memory. */
export interface BuilderState {
  projectId: string | null;
  projectName: string | null;
  pipelineRunId: string | null;
  agentRunId: string | null;
  previewSessionId: string | null;
  frontendUrl: string | null;
  backendUrl: string | null;
  validationGate: string | null;
  repaired: boolean;
  /** Set by `inspect_website` when the running site answered as expected. */
  inspected: boolean;
  /** Whether the latest successful build fell back to built-in rules anywhere. */
  buildDegraded: boolean | null;
  landingSections: string[];
}

export interface BuilderResult {
  /** Built, running and inspected — the task's definition of done. */
  complete: boolean;
  summary: string;
  projectId: string | null;
  frontendUrl: string | null;
  backendUrl: string | null;
  validationGate: string | null;
  landingSections: string[];
}

export interface BuilderSession {
  id: string;
  task: string;
  status: BuilderStatus;
  plan: string[];
  steps: BuilderStep[];
  state: BuilderState;
  result: BuilderResult | null;
  error: string | null;
  usage: {
    decisions: number;
    modelDecisions: number;
    policyDecisions: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StartBuilderInput {
  task: string;
}
