/**
 * Execution visibility: an ordered, durable record of what a job really did.
 *
 * Two promises shape everything here. Order: events for one job are written
 * one at a time, so `seq` matches the order they were published in. And
 * safety: nothing here can fail the build it describes. Every publish
 * resolves, returning null when the event could not be recorded, because
 * losing a line of history is bad and losing a generated project to it is
 * worse. Import this file directly from pipelines; the module index also
 * pulls in the router and would close an import loop.
 */
import { logger } from '../../shared/logger/index.js';
import { redactString, redactValue } from '../../shared/security/redact.js';
import { MAX_EVENTS_PER_READ, defaultStore } from './lib/event-store.js';
import type { ExecutionStore, JobRecord } from './lib/event-store.js';
import type {
  ExecutionEvent,
  ExecutionJobSummary,
  PublishExecutionEventInput,
  RecordStageUsageInput,
  StageUsageRecord,
} from './execution-events.types.js';

const MAX_MESSAGE_CHARS = 2_000;
const MAX_DATA_BYTES = 32_000;
/** Deeper than a log line, shallow enough to stay cheap per event. */
const REDACT_DEPTH = 8;

export type ExecutionEventListener = (event: ExecutionEvent) => void;

let store: ExecutionStore = defaultStore();
const listeners = new Map<string, Set<ExecutionEventListener>>();
const tails = new Map<string, Promise<unknown>>();

/** Test seam: the promises above are about failure, so tests need failures. */
export function useExecutionStore(next: ExecutionStore = defaultStore()): void {
  store = next;
}

function describe(error: unknown): string {
  return redactString(error instanceof Error ? error.message : String(error));
}

function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(redactValue(data, 0, REDACT_DEPTH));
  const bytes = Buffer.byteLength(serialized);
  // Replaced, not cut: half a JSON document is not a smaller document.
  if (bytes > MAX_DATA_BYTES) return { omitted: 'payload too large', bytes };
  return JSON.parse(serialized) as Record<string, unknown>;
}

function clean(input: PublishExecutionEventInput): PublishExecutionEventInput {
  return {
    ...input,
    message: redactString(input.message).slice(0, MAX_MESSAGE_CHARS),
    ...(input.data === undefined ? {} : { data: cleanData(input.data) }),
  };
}

function notify(event: ExecutionEvent): void {
  for (const listener of listeners.get(event.jobId) ?? []) {
    try {
      listener(event);
    } catch (error) {
      logger.warn('execution event listener threw', { error: describe(error) });
    }
  }
}

/**
 * Records and broadcasts one event. Always resolves; null means not recorded.
 * Awaiting it is optional, and order is kept either way.
 */
export function publishExecutionEvent(
  input: PublishExecutionEventInput,
): Promise<ExecutionEvent | null> {
  const write = async (): Promise<ExecutionEvent | null> => {
    try {
      const event = await store.append(clean(input));
      notify(event);
      return event;
    } catch (error) {
      logger.warn('execution event could not be recorded', {
        jobId: input.jobId,
        type: input.type,
        error: describe(error),
      });
      return null;
    }
  };
  const tail = (tails.get(input.jobId) ?? Promise.resolve()).then(write);
  tails.set(input.jobId, tail);
  void tail.finally(() => {
    if (tails.get(input.jobId) === tail) tails.delete(input.jobId);
  });
  return tail;
}

/** Events after `afterSeq`, in order. At most `limit`, capped server-side. */
export async function listExecutionEvents(
  jobId: string,
  afterSeq = 0,
  limit = MAX_EVENTS_PER_READ,
): Promise<ExecutionEvent[]> {
  return store.list(jobId, afterSeq, Math.min(Math.max(limit, 1), MAX_EVENTS_PER_READ));
}

/** Live events for a job. Returns the function that stops listening. */
export function subscribeToExecutionEvents(
  jobId: string,
  listener: ExecutionEventListener,
): () => void {
  const set = listeners.get(jobId) ?? new Set<ExecutionEventListener>();
  set.add(listener);
  listeners.set(jobId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(jobId) === set) listeners.delete(jobId);
  };
}

/** How many listeners a job has. Exists so tests can prove cleanup happened. */
export function executionListenerCount(jobId: string): number {
  return listeners.get(jobId)?.size ?? 0;
}

/** Records what a stage consumed. Always resolves; null means not recorded. */
export async function recordStageUsage(
  input: RecordStageUsageInput,
): Promise<StageUsageRecord | null> {
  try {
    return await store.recordUsage(input);
  } catch (error) {
    logger.warn('stage usage could not be recorded', {
      jobId: input.jobId,
      stage: input.stage,
      error: describe(error),
    });
    return null;
  }
}

export async function listStageUsage(jobId: string): Promise<StageUsageRecord[]> {
  return store.listUsage(jobId);
}

/** A job's record from its own table, or null when it is not in this project. */
export async function findJobRecord(projectId: string, jobId: string): Promise<JobRecord | null> {
  return store.jobRecord(projectId, jobId);
}

/**
 * Ends the streams of jobs whose process is gone and whose owner cannot.
 *
 * Builds and enhancements have rows that their own boot sweeps settle; an
 * agent run lives in memory, so nothing else knows it stopped. Bounded,
 * because a backlog this old stops mattering to anyone watching.
 */
export async function interruptOrphanedJobs(limit = 200): Promise<number> {
  const unsettled = await store.unsettledJobs(limit);
  let interrupted = 0;
  for (const job of unsettled) {
    if ((await store.jobRecord(job.projectId, job.jobId)) !== null) continue;
    const published = await publishExecutionEvent({
      ...job,
      type: 'job.interrupted',
      status: 'failed',
      message: 'This agent run was interrupted by a server restart',
      data: {},
    });
    if (published !== null) interrupted += 1;
  }
  return interrupted;
}

/**
 * Whether a job belongs to a project. Checks events as well as the job's own
 * table because a run can publish before its row exists, or lose that row to
 * a failed write and still have a real history.
 */
export async function jobBelongsToProject(projectId: string, jobId: string): Promise<boolean> {
  if (await store.jobRecord(projectId, jobId)) return true;
  return (await store.jobProject(jobId)) === projectId;
}

/** Every run and enhancement of a project, newest first. */
export async function listExecutionJobs(
  projectId: string,
  limit = 50,
): Promise<ExecutionJobSummary[]> {
  const [records, stats] = await Promise.all([
    store.jobRecords(projectId, limit),
    store.statsForProject(projectId),
  ]);
  const byJob = new Map(stats.map((entry) => [entry.jobId, entry]));
  const known = new Set(records.map((record) => record.jobId));
  const summaries: ExecutionJobSummary[] = records.map((record) => {
    const entry = byJob.get(record.jobId);
    return {
      ...record,
      eventCount: entry?.eventCount ?? 0,
      lastSeq: entry?.lastSeq ?? 0,
      lastEventAt: entry?.lastEventAt ?? null,
    };
  });
  for (const entry of stats) {
    if (known.has(entry.jobId)) continue;
    summaries.push({
      jobId: entry.jobId,
      jobKind: entry.jobKind,
      status: 'unknown',
      title: null,
      createdAt: entry.firstEventAt,
      eventCount: entry.eventCount,
      lastSeq: entry.lastSeq,
      lastEventAt: entry.lastEventAt,
    });
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
