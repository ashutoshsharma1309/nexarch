/**
 * The vocabulary of execution visibility.
 *
 * Every event names something that really happened. There are deliberately
 * no percentages, no heartbeat "progress" events and no placeholder stages:
 * a timeline the server padded out is worse than a short one.
 */
export type ExecutionJobKind = 'RUN' | 'ENHANCEMENT';

export const EXECUTION_EVENT_TYPES = [
  // A job's own lifecycle. The four `job.*` terminal types end a stream.
  'job.started',
  'job.completed',
  'job.failed',
  'job.cancelled',
  'job.interrupted',
  'stage.started',
  'stage.completed',
  'stage.failed',
  'stage.skipped',
  'agent.started',
  'agent.completed',
  'agent.failed',
  // A real model call, after it returned.
  'model.call',
  'research.query',
  'research.source',
  'research.limitation',
  'files.changed',
  'verify.started',
  'verify.check',
  'verify.completed',
  'repair.attempt',
  'repair.completed',
  'enhancement.planned',
  'enhancement.applied',
  'enhancement.reverted',
  // A human-readable note for anything the types above do not cover.
  'note',
] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export const TERMINAL_EVENT_TYPES: readonly ExecutionEventType[] = [
  'job.completed',
  'job.failed',
  'job.cancelled',
  'job.interrupted',
];

export function isTerminalEventType(type: string): boolean {
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(type);
}

export type ExecutionEventStatus =
  'started' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'info';

/** The same outcome vocabulary for any job, whichever table it lives in. */
export type ExecutionJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';

export interface PublishExecutionEventInput {
  projectId: string;
  jobKind: ExecutionJobKind;
  jobId: string;
  type: ExecutionEventType;
  message: string;
  status?: ExecutionEventStatus | undefined;
  stage?: string | undefined;
  agentId?: string | undefined;
  /** JSON-safe detail. Secrets are redacted; oversized payloads are replaced. */
  data?: Record<string, unknown> | undefined;
}

export interface ExecutionEvent {
  id: string;
  projectId: string;
  jobKind: ExecutionJobKind;
  jobId: string;
  /** Per job, strictly increasing from 1. Also the SSE event id. */
  seq: number;
  type: string;
  status: string | null;
  stage: string | null;
  agentId: string | null;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface RecordStageUsageInput {
  projectId: string;
  jobId: string;
  stage: string;
  agentId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  /** Omit when the provider did not report it: unknown is not zero. */
  inputTokens?: number | null | undefined;
  outputTokens?: number | null | undefined;
  costUsd?: number | null | undefined;
  durationMs: number;
}

export interface StageUsageRecord {
  id: string;
  projectId: string;
  jobId: string;
  stage: string;
  agentId: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  createdAt: string;
}

export interface ExecutionJobSummary {
  jobId: string;
  jobKind: ExecutionJobKind;
  status: ExecutionJobStatus;
  /** The prompt or instruction that started it. */
  title: string | null;
  createdAt: string;
  /** 0 for jobs from before events existed: there is no history to show. */
  eventCount: number;
  lastSeq: number;
  lastEventAt: string | null;
}
