/**
 * The contract for real build verification.
 *
 * Every field reports something a process or an HTTP server actually did.
 * `blocked` exists so a check that could not run is never read as a pass or
 * blamed on the project: it says only that something before it failed.
 */
export interface ProjectFile {
  path: string;
  content: string;
}

export type VerificationStepId = 'install' | 'typecheck' | 'build' | 'start' | 'health' | 'routes';

export type VerificationStepStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export interface VerificationStep {
  id: VerificationStepId;
  status: VerificationStepStatus;
  command: string | null;
  exitCode: number | null;
  durationMs: number;
  /** One readable line. */
  summary: string;
  /** Scrubbed and tail-capped. */
  output: string;
  /** Why it was skipped or blocked. */
  reason: string | null;
}

export interface RouteCheck {
  method: string;
  path: string;
  expectedStatus: number | null;
  actualStatus: number | null;
  status: 'passed' | 'failed' | 'blocked';
  detail: string | null;
}

export interface VerificationResult {
  /** True only if every non-skipped step passed. */
  ok: boolean;
  steps: VerificationStep[];
  routes: RouteCheck[];
  /** What was not, or could not be, checked. */
  limitations: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface DeclaredRoute {
  method: string;
  path: string;
  expectedStatus?: number;
}

export interface VerifyProjectOptions {
  projectId: string;
  jobId: string;
  jobKind: 'RUN' | 'ENHANCEMENT';
  routes?: DeclaredRoute[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Default true: emits verify.* events. */
  publish?: boolean;
}

export interface RepairAttempt {
  attempt: number;
  targets: string[];
  changedFiles: string[];
  /** Of this attempt's files. An attempt that changed nothing repeats the last result. */
  verification: VerificationResult;
  /** Why no verification ran for this attempt. Absent when one did. */
  notVerified?: 'invalid-reply' | 'no-applicable-edit';
}

/** One repair model call. Null means the provider did not report the figure. */
export interface RepairModelUsage {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  cacheHit: boolean;
}

export interface RepairResult {
  /**
   * True only when a repair ran and the final verification passed. A project
   * that was already passing was not repaired, so it reports false with an
   * ok `verification` and no attempts.
   */
  repaired: boolean;
  /** The best set; the originals if nothing helped. */
  files: ProjectFile[];
  /** Of the returned files, really executed. */
  verification: VerificationResult;
  attempts: RepairAttempt[];
  limitations: string[];
  /** Every model call the repair made, so the run's totals can include them. */
  usage: RepairModelUsage[];
}

export interface RepairOptions extends VerifyProjectOptions {
  /** Default 2, hard cap 3. */
  maxAttempts?: number;
}
