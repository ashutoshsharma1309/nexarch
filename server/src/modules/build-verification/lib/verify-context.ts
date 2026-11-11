/**
 * The running record of one verification.
 *
 * Every step starts blocked, so a path that forgets one, or an exception that
 * cuts the run short, leaves "did not run" on the record and never a pass.
 */
import type { PublishExecutionEventInput } from '../../execution-events/execution-events.types.js';
import type {
  ProjectFile,
  RouteCheck,
  VerificationResult,
  VerificationStep,
  VerificationStepId,
  VerifyProjectOptions,
} from '../build-verification.types.js';

export const STEP_ORDER: VerificationStepId[] = [
  'install',
  'typecheck',
  'build',
  'start',
  'health',
  'routes',
];

export type Publish = (event: PublishExecutionEventInput) => Promise<unknown>;

export class VerifyContext {
  readonly steps = new Map<VerificationStepId, VerificationStep>();
  readonly routes: RouteCheck[] = [];
  readonly limitations: string[] = [];
  workspaceDir: string | null = null;
  private readonly startedAt = new Date();

  constructor(
    readonly files: readonly ProjectFile[],
    readonly options: VerifyProjectOptions,
    readonly signal: AbortSignal,
    private readonly publishEvent: Publish,
  ) {
    for (const id of STEP_ORDER) {
      this.steps.set(id, {
        id,
        status: 'blocked',
        command: null,
        exitCode: null,
        durationMs: 0,
        summary: 'Did not run',
        output: '',
        reason: 'Verification did not reach this step',
      });
    }
  }

  private emit(event: Omit<PublishExecutionEventInput, 'projectId' | 'jobKind' | 'jobId'>): void {
    if (this.options.publish === false) return;
    void this.publishEvent({
      projectId: this.options.projectId,
      jobKind: this.options.jobKind,
      jobId: this.options.jobId,
      stage: 'testing',
      ...event,
    });
  }

  begin(): void {
    this.emit({
      type: 'verify.started',
      status: 'started',
      message: 'Verifying the project by building and running it',
      data: { steps: STEP_ORDER },
    });
  }

  record(step: Partial<VerificationStep> & { id: VerificationStepId; summary: string }): void {
    const previous = this.steps.get(step.id);
    if (!previous) return;
    const next: VerificationStep = { ...previous, reason: null, ...step };
    this.steps.set(step.id, next);
    const status =
      next.status === 'passed' ? 'succeeded' : next.status === 'failed' ? 'failed' : 'skipped';
    this.emit({
      type: 'verify.check',
      status,
      message: `${step.id}: ${next.summary}`,
      data: {
        id: next.id,
        ...(next.command === null ? {} : { command: next.command }),
        ...(next.exitCode === null ? {} : { exitCode: next.exitCode }),
        durationMs: next.durationMs,
        summary: next.summary,
      },
    });
  }

  recordRoute(check: RouteCheck): void {
    this.routes.push(check);
    const status =
      check.status === 'passed' ? 'succeeded' : check.status === 'failed' ? 'failed' : 'skipped';
    this.emit({
      type: 'verify.check',
      status,
      message: `${check.method} ${check.path}: ${String(check.actualStatus ?? 'no answer')}`,
      data: {
        id: 'route',
        method: check.method,
        path: check.path,
        actualStatus: check.actualStatus,
        expected: check.expectedStatus,
      },
    });
  }

  /** Marks everything that has not run as blocked, for this reason. */
  block(ids: readonly VerificationStepId[], reason: string): void {
    for (const id of ids) {
      const step = this.steps.get(id);
      // A command that started and was stopped keeps its own record.
      if (step?.status !== 'blocked' || step.command !== null) continue;
      this.steps.set(id, { ...step, summary: 'Did not run', reason });
      this.emit({
        type: 'verify.check',
        status: 'skipped',
        message: `${id}: blocked (${reason})`,
        data: { id, durationMs: 0, summary: `Blocked: ${reason}` },
      });
    }
  }

  note(limitation: string): void {
    if (!this.limitations.includes(limitation)) this.limitations.push(limitation);
  }

  finish(): VerificationResult {
    const steps = STEP_ORDER.flatMap((id) => {
      const step = this.steps.get(id);
      return step ? [step] : [];
    });
    const ok =
      steps.some((step) => step.status === 'passed') &&
      steps.every((step) => step.status === 'passed' || step.status === 'skipped');
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.startedAt.getTime();
    const failed = steps.filter((step) => step.status === 'failed').map((step) => step.id);
    this.emit({
      type: 'verify.completed',
      status: ok ? 'succeeded' : 'failed',
      message: ok
        ? 'Verification passed'
        : `Verification did not pass (${failed.join(', ') || 'blocked'})`,
      data: { ok, durationMs, failed, limitations: this.limitations },
    });
    return {
      ok,
      steps,
      routes: this.routes,
      limitations: this.limitations,
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
    };
  }
}
