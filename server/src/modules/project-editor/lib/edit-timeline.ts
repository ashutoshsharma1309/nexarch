/**
 * A plain edit's entry in the execution timeline.
 *
 * Plain edits used to publish nothing, so `/executions/:jobId/events` and
 * `/usage` answered 404 for them and their tokens could not be read. These are
 * recorded under the `ENHANCEMENT` job kind because that is the only `edit_jobs`
 * kind the event table's enum holds; `data.editJob` says which it really was.
 * Every event names something that happened. Publishing never throws.
 */
import type { GenerateResponse } from '../../ai-orchestrator/ai-orchestrator.types.js';
import {
  publishExecutionEvent,
  recordStageUsage,
} from '../../execution-events/execution-events.service.js';
import type {
  ExecutionEventStatus,
  ExecutionEventType,
} from '../../execution-events/execution-events.types.js';
import type { ChangedFile, EditValidation } from '../project-editor.types.js';

const AGENT_ID = 'project-editor';

/** One model call made while planning, kept until the job exists to charge it to. */
export interface EditModelCall {
  promptId: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  cacheHit: boolean;
}

/** Unknown stays null: a provider that reported nothing did not use nothing. */
export function editCallFrom(response: GenerateResponse): EditModelCall {
  const { record } = response;
  const reported =
    record.cacheHit || record.tokens.inputTokens > 0 || record.tokens.outputTokens > 0;
  return {
    promptId: record.promptId,
    provider: record.provider,
    model: record.model,
    inputTokens: reported ? record.tokens.inputTokens : null,
    outputTokens: reported ? record.tokens.outputTokens : null,
    costUsd: record.cost.totalCostUsd,
    durationMs: record.durationMs,
    cacheHit: record.cacheHit,
  };
}

export class EditTimeline {
  private open: { stage: string; startedAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly jobId: string,
  ) {}

  emit(
    type: ExecutionEventType,
    message: string,
    status: ExecutionEventStatus,
    extra: { stage?: string; data?: Record<string, unknown> } = {},
  ): void {
    const { stage, data } = extra;
    void publishExecutionEvent({
      projectId: this.projectId,
      jobKind: 'ENHANCEMENT',
      jobId: this.jobId,
      type,
      message,
      status,
      agentId: AGENT_ID,
      ...(stage === undefined ? {} : { stage }),
      data: { ...data, editJob: true },
    });
  }

  /** Calls made before the job existed, marked as such and charged to it. */
  replayPlanning(calls: readonly EditModelCall[], plannedAt: string): void {
    for (const call of calls) {
      this.emit('model.call', `${call.provider} ${call.model} answered`, 'succeeded', {
        stage: 'planning',
        data: {
          provider: call.provider,
          model: call.model,
          durationMs: call.durationMs,
          promptId: call.promptId,
          replayed: true,
          occurredAt: plannedAt,
        },
      });
      void recordStageUsage({
        projectId: this.projectId,
        jobId: this.jobId,
        stage: 'planning',
        agentId: AGENT_ID,
        provider: call.provider,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        costUsd: call.costUsd,
        durationMs: call.durationMs,
      });
    }
  }

  enterStage(stage: string, detail?: string): void {
    this.closeStage(detail);
    this.open = { stage, startedAt: Date.now() };
    this.emit('stage.started', `Started ${stage}`, 'started', { stage });
  }

  closeStage(summary?: string): void {
    if (!this.open) return;
    const { stage, startedAt } = this.open;
    this.open = null;
    this.emit('stage.completed', `Finished ${stage}`, 'succeeded', {
      stage,
      data: { durationMs: Date.now() - startedAt, ...(summary ? { summary } : {}) },
    });
  }

  failStage(error: string): string | null {
    if (!this.open) return null;
    const { stage, startedAt } = this.open;
    this.open = null;
    this.emit('stage.failed', `${stage} did not complete`, 'failed', {
      stage,
      data: { durationMs: Date.now() - startedAt, error },
    });
    return stage;
  }

  filesChanged(changed: readonly ChangedFile[]): void {
    this.emit('files.changed', `${String(changed.length)} files changed`, 'info', {
      data: { modified: changed.map((file) => file.path).slice(0, 200) },
    });
  }

  checks(validation: EditValidation): void {
    for (const check of validation.checks) {
      const status =
        check.status === 'PASS' ? 'succeeded' : check.status === 'FAIL' ? 'failed' : 'skipped';
      this.emit('verify.check', check.name, status, {
        data: { id: check.name.toLowerCase(), summary: check.detail },
      });
    }
  }
}
