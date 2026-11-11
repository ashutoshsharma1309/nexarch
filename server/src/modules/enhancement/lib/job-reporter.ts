/**
 * One job's account of itself.
 *
 * Stage boundaries, model calls and the single terminal event all go through
 * here so that "exactly one terminal event" and "every stage that opened is
 * closed" are properties of one class rather than of every code path.
 */
import { setLogContext } from '../../../shared/logger/context.js';
import type { JobStage } from '../../project-editor/lib/edit-job-store.js';
import type {
  ExecutionEventStatus,
  ExecutionEventType,
} from '../../execution-events/execution-events.types.js';
import type { RepairModelUsage } from '../../build-verification/index.js';
import type { ModelCallUsage } from '../enhancement.types.js';
import type { EnhancementDeps } from './deps.js';

interface OpenStage {
  stage: JobStage;
  agentId: string;
  startedAt: number;
}

export class JobReporter {
  readonly usage: ModelCallUsage[] = [];
  private open: OpenStage | null = null;
  private terminalSent = false;

  constructor(
    private readonly deps: EnhancementDeps,
    readonly projectId: string,
    readonly jobId: string,
  ) {}

  emit(
    type: ExecutionEventType,
    message: string,
    status: ExecutionEventStatus,
    extra: { stage?: string; agentId?: string; data?: Record<string, unknown> } = {},
  ): void {
    void this.deps.publish({
      projectId: this.projectId,
      jobKind: 'ENHANCEMENT',
      jobId: this.jobId,
      type,
      message,
      status,
      ...extra,
    });
  }

  /**
   * Reports a call made inside the job. Its usage row is written where the
   * call happens, from the job's context, so one call stays one row.
   */
  recordCall(call: ModelCallUsage): void {
    this.reportCall(call);
  }

  /** A call made while planning, before the job existed to charge it to. */
  replayPlanningCall(call: ModelCallUsage, plannedAt: string): void {
    this.reportCall(call, { replayed: true, occurredAt: plannedAt });
    void this.deps.recordUsage({
      projectId: this.projectId,
      jobId: this.jobId,
      stage: call.stage,
      agentId: call.agentId,
      provider: call.provider,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: call.costUsd,
      durationMs: call.durationMs,
    });
  }

  /** Repair publishes its own calls; only the totals still need them. */
  addRepairUsage(calls: readonly RepairModelUsage[]): void {
    for (const call of calls) {
      this.usage.push({ ...call, stage: 'repairing', agentId: 'build-repair' });
    }
  }

  private reportCall(call: ModelCallUsage, marker: Record<string, unknown> = {}): void {
    this.usage.push(call);
    const { stage } = call;
    this.emit('model.call', `${call.provider} ${call.model} answered`, 'succeeded', {
      stage,
      agentId: call.agentId,
      data: { provider: call.provider, model: call.model, durationMs: call.durationMs, ...marker },
    });
  }

  async enterStage(stage: JobStage, agentId: string, detail?: string): Promise<void> {
    this.closeStage(detail);
    await this.deps.store.advanceStage(this.jobId, stage, detail ?? null);
    this.open = { stage, agentId, startedAt: Date.now() };
    setLogContext({ stage, agentId });
    this.emit('stage.started', `Started ${stage}`, 'started', { stage, agentId, data: {} });
  }

  /** Ends the open stage as succeeded. The failing path uses `failStage`. */
  closeStage(summary?: string): void {
    if (!this.open) return;
    const { stage, agentId, startedAt } = this.open;
    this.open = null;
    this.emit('stage.completed', `Finished ${stage}`, 'succeeded', {
      stage,
      agentId,
      data: { durationMs: Date.now() - startedAt, ...(summary ? { summary } : {}) },
    });
  }

  failStage(error: string): string | null {
    if (!this.open) return null;
    const { stage, agentId, startedAt } = this.open;
    this.open = null;
    this.emit('stage.failed', `${stage} did not complete`, 'failed', {
      stage,
      agentId,
      data: { durationMs: Date.now() - startedAt, error },
    });
    return stage;
  }

  get currentStage(): string | null {
    return this.open?.stage ?? null;
  }

  terminal(
    type: 'job.completed' | 'job.failed' | 'job.cancelled',
    message: string,
    status: ExecutionEventStatus,
    extra: { stage?: string; data?: Record<string, unknown> } = {},
  ): void {
    if (this.terminalSent) return;
    this.terminalSent = true;
    this.emit(type, message, status, { data: {}, ...extra });
  }
}
