/**
 * What the execution API returns. Mirrors the server's
 * `execution-events.types.ts`. Every event is something that really happened,
 * so a short timeline is an honest one: never pad it on this side.
 */
export type ExecutionJobKind = 'RUN' | 'ENHANCEMENT';

export type ExecutionEventType =
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.interrupted'
  | 'stage.started'
  | 'stage.completed'
  | 'stage.failed'
  | 'stage.skipped'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'model.call'
  | 'research.query'
  | 'research.source'
  | 'research.limitation'
  | 'files.changed'
  | 'verify.started'
  | 'verify.check'
  | 'verify.completed'
  | 'repair.attempt'
  | 'repair.completed'
  | 'enhancement.planned'
  | 'enhancement.applied'
  | 'enhancement.reverted'
  | 'note';

export type ExecutionEventStatus =
  'started' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'info';

export type ExecutionJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';

export interface ExecutionEvent {
  id: string;
  projectId: string;
  jobKind: ExecutionJobKind;
  jobId: string;
  /** Per job, strictly increasing from 1. Resume with `after=<seq>`. */
  seq: number;
  /** Typed as string too: an older client must survive a newer server. */
  type: ExecutionEventType | (string & {});
  status: ExecutionEventStatus | (string & {}) | null;
  stage: string | null;
  agentId: string | null;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface ExecutionJobSummary {
  jobId: string;
  jobKind: ExecutionJobKind;
  status: ExecutionJobStatus;
  title: string | null;
  createdAt: string;
  /** 0 means the job predates event history, not that nothing happened. */
  eventCount: number;
  lastSeq: number;
  lastEventAt: string | null;
}

export interface StageUsageRecord {
  id: string;
  projectId: string;
  jobId: string;
  stage: string;
  agentId: string | null;
  provider: string | null;
  model: string | null;
  /** Null means the provider did not report it. Show "unknown", not 0. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  createdAt: string;
}

/** The payload of the SSE `end` event; the stream closes after it. */
export interface ExecutionStreamEnd {
  reason: 'terminal-event' | 'job-settled';
  lastSeq: number;
}

/** Working stages of an enhancement job, under status RUNNING. */
export type EnhancementStage =
  | 'queued'
  | 'researching'
  | 'planning'
  | 'implementing'
  | 'testing'
  | 'repairing'
  | 'finished'
  | 'cancelled';
