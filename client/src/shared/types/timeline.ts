/**
 * Execution timeline types.
 *
 * Deliberately a file of their own rather than an addition to `api.ts`: the
 * timeline is an operational read with its own lifetime — in-memory on the
 * server, gone after a restart — and keeping it out of the main API surface
 * keeps that distinction visible to whoever reads these types next.
 */

/** One operational event, as the server published it. */
export interface TimelineEvent {
  event: string;
  [field: string]: unknown;
}

export interface TimelineEntry {
  at: string;
  event: TimelineEvent;
}

/**
 * The derived answers. A null means nothing measured it — which is a
 * different fact from zero, and the server is careful about the difference.
 */
export interface TimelineSummary {
  slowestStage: { stage: string; durationMs: number } | null;
  totalStageMs: number | null;
  failedAgents: string[];
  degradedAgents: string[];
  retries: number;
  modelCalls: number;
  cachedModelCalls: number;
  failedModelCalls: number;
  modelRetries: number | null;
  costUsd: number | null;
  validationMs: number | null;
  validationsPassed: number;
  validationsFailed: number;
  repairAttempts: number;
  repairsFixed: number;
  rollbacks: number;
  unexpectedProcessExits: number;
  firstFailureReason: string | null;
}

export interface TimelineHeader {
  key: string;
  startedAt: string;
  updatedAt: string;
  events: number;
  truncated: boolean;
  summary: TimelineSummary;
}

export interface TimelineList {
  timelines: TimelineHeader[];
  /** The server's own statement of how long these live. Shown, not assumed. */
  retention: string;
}

export interface Timeline {
  key: string;
  startedAt: string;
  updatedAt: string;
  entries: TimelineEntry[];
  truncated: boolean;
  summary: TimelineSummary;
}
