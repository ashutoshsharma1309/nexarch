/**
 * The durable timeline of a run, published as the run really proceeds.
 *
 * Only what happened is published, after it happened. A stage is announced
 * under its agent identity together with the engine that really did the work,
 * so a deterministic stage reads as code rather than as an AI agent.
 *
 * A run with no project has nowhere to record to and publishes nothing.
 * Publishing never rejects, so nothing here can fail the build it describes.
 */
import {
  publishExecutionEvent,
  recordStageUsage,
} from '../../execution-events/execution-events.service.js';
import type {
  ExecutionEventStatus,
  ExecutionEventType,
} from '../../execution-events/execution-events.types.js';
import type { ResearchArtifact } from '../../web-research/web-research.types.js';
import type { PipelineRun, PipelineStage, StageId } from '../pipeline.types.js';
import type { AiCallStat } from './ai-stages.js';

const MAX_LISTED_FILES = 200;

export class RunEvents {
  constructor(private readonly run: PipelineRun) {}

  private publish(
    type: ExecutionEventType,
    message: string,
    fields: {
      status?: ExecutionEventStatus;
      stage?: string;
      agentId?: string;
      data?: Record<string, unknown>;
    } = {},
  ): Promise<unknown> {
    const projectId = this.run.projectId;
    if (projectId === null) return Promise.resolve(null);
    return publishExecutionEvent({
      projectId,
      jobKind: 'RUN',
      jobId: this.run.id,
      type,
      message,
      ...fields,
    });
  }

  /** Timing only: model calls are recorded where they happen, one row each. */
  private timingRow(input: { stage: StageId; agentId: string; durationMs: number }): void {
    const projectId = this.run.projectId;
    if (projectId === null) return;
    void recordStageUsage({
      projectId,
      jobId: this.run.id,
      stage: input.stage,
      agentId: input.agentId,
      durationMs: input.durationMs,
    });
  }

  jobStarted(): void {
    void this.publish('job.started', `Build started for ${this.run.projectName}`, {
      status: 'started',
      data: { title: this.run.projectName },
    });
  }

  /** `verified` is null when no verification ran, which is not a pass. */
  async jobCompleted(durationMs: number, verified: boolean | null = null): Promise<void> {
    const detail = this.run.outcomeDetail;
    const outcome = this.run.outcome;
    const message =
      outcome === undefined || outcome === 'verified'
        ? `Build finished for ${this.run.projectName}`
        : `Build finished for ${this.run.projectName}, but ${detail ?? 'it did not pass verification'}`;
    await this.publish('job.completed', message, {
      // A build that did not pass verification did not succeed, even though
      // the job ran to the end and its files are kept.
      status: outcome === 'verified' || outcome === undefined ? 'succeeded' : 'failed',
      data: {
        runId: this.run.id,
        durationMs,
        verified,
        ...(outcome === undefined ? {} : { outcome }),
      },
    });
  }

  async jobFailed(stage: PipelineStage | undefined, error: string): Promise<void> {
    await this.publish('job.failed', `Build failed: ${error}`, {
      status: 'failed',
      ...(stage === undefined ? {} : { stage: stage.id, agentId: stage.agentId }),
      data: { error },
    });
  }

  stageStarted(stage: PipelineStage): void {
    void this.publish('stage.started', `${stage.label} started`, {
      status: 'started',
      stage: stage.id,
      agentId: stage.agentId,
    });
    // Whether a model answers is not known yet, so nothing claims one will.
    const engine = stage.engine === 'ai' ? '' : ' (deterministic code)';
    void this.publish('agent.started', `${stage.agentId}${engine}: ${stage.responsibility}`, {
      status: 'started',
      stage: stage.id,
      agentId: stage.agentId,
      data: {
        task: stage.responsibility,
        ...(stage.engine === 'ai' ? {} : { engine: stage.engine }),
      },
    });
  }

  /**
   * `hadModelCall` keeps a stage's row count honest: a model stage already has
   * one usage row per call, so only a stage with none gets a timing-only row.
   */
  stageCompleted(stage: PipelineStage, hadModelCall: boolean): void {
    const durationMs = stage.durationMs ?? 0;
    const summary = stage.summary ?? '';
    void this.publish('agent.completed', `${stage.agentId} finished: ${summary}`, {
      status: 'succeeded',
      stage: stage.id,
      agentId: stage.agentId,
      data: { durationMs },
    });
    void this.publish('stage.completed', `${stage.label}: ${summary}`, {
      status: 'succeeded',
      stage: stage.id,
      agentId: stage.agentId,
      data: { durationMs, summary, degraded: stage.degraded },
    });
    if (!hadModelCall) this.timingRow({ stage: stage.id, agentId: stage.agentId, durationMs });
  }

  stageFailed(stage: PipelineStage): void {
    const durationMs = stage.durationMs ?? 0;
    const error = stage.error ?? 'unknown failure';
    void this.publish('agent.failed', `${stage.agentId} failed: ${error}`, {
      status: 'failed',
      stage: stage.id,
      agentId: stage.agentId,
      data: { durationMs, error },
    });
    void this.publish('stage.failed', `${stage.label} failed: ${error}`, {
      status: 'failed',
      stage: stage.id,
      agentId: stage.agentId,
      data: { durationMs, error },
    });
  }

  stageSkipped(stage: PipelineStage, reason: string): void {
    void this.publish('stage.skipped', `${stage.label} skipped: ${reason}`, {
      status: 'skipped',
      stage: stage.id,
      data: { reason },
    });
  }

  note(stage: StageId, message: string, data: Record<string, unknown> = {}): void {
    void this.publish('note', message, { status: 'info', stage, data });
  }

  /** A cached answer costs nothing and calls nothing, so it is not a model call. */
  modelCall(stage: PipelineStage, stat: AiCallStat): void {
    if (stat.cacheHit) {
      this.note(stage.id, `${stage.agentId} reused a cached model answer`);
      return;
    }
    void this.publish('model.call', `${stat.provider}/${stat.model} answered`, {
      status: 'succeeded',
      stage: stage.id,
      agentId: stage.agentId,
      data: {
        provider: stat.provider,
        model: stat.model,
        durationMs: stat.durationMs,
        attempt: stat.attempt,
      },
    });
  }

  /**
   * The research record, replayed once research returns. The engine does not
   * stream, so these arrive together after the work rather than during it.
   */
  research(stage: PipelineStage, artifact: ResearchArtifact): void {
    for (const query of artifact.queries) {
      void this.publish('research.query', `Searched: ${query.query}`, {
        status: 'info',
        stage: 'research',
        data: { provider: query.provider, query: query.query, results: query.results },
      });
    }
    for (const source of artifact.sources) {
      void this.publish('research.source', source.title || source.url, {
        status: 'info',
        stage: 'research',
        data: { url: source.url, title: source.title, retrieval: source.retrievalKind },
      });
    }
    for (const detail of artifact.limitations) {
      void this.publish('research.limitation', detail, {
        status: 'info',
        stage: 'research',
        data: { detail },
      });
    }
    for (const call of artifact.usage.modelCalls) {
      if (call.cacheHit) continue;
      void this.publish('model.call', `${call.provider}/${call.model}: ${call.purpose}`, {
        status: call.status === 'success' ? 'succeeded' : 'failed',
        stage: 'research',
        agentId: stage.agentId,
        data: {
          provider: call.provider,
          model: call.model,
          durationMs: call.durationMs,
          ...(call.note === null ? {} : { error: call.note }),
        },
      });
    }
  }

  filesChanged(stage: StageId, created: readonly string[], modified: readonly string[]): void {
    if (created.length + modified.length === 0) return;
    void this.publish(
      'files.changed',
      `${created.length} file(s) created, ${modified.length} changed`,
      {
        status: 'info',
        stage,
        data: {
          created: created.slice(0, MAX_LISTED_FILES),
          modified: modified.slice(0, MAX_LISTED_FILES),
          deleted: [],
        },
      },
    );
  }
}
