/**
 * Where events and usage rows live: Postgres, or memory in no-database mode.
 *
 * Behind an interface because the service's two hard promises — a stable
 * order and never throwing into a build — are tested against a store that
 * fails on demand, which a real database will not do when asked.
 */
import { Prisma } from '@prisma/client';

import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { logger } from '../../../shared/logger/index.js';
import { memGenerationsForProject } from '../../pipeline/lib/run-store.js';
import { isTerminalEventType, TERMINAL_EVENT_TYPES } from '../execution-events.types.js';
import type {
  ExecutionEvent,
  ExecutionJobKind,
  ExecutionJobStatus,
  PublishExecutionEventInput,
  RecordStageUsageInput,
  StageUsageRecord,
} from '../execution-events.types.js';

/** A read page is bounded so one huge job cannot produce one huge response. */
export const MAX_EVENTS_PER_READ = 500;

export interface JobEventStats {
  jobId: string;
  jobKind: ExecutionJobKind;
  eventCount: number;
  lastSeq: number;
  lastEventAt: string;
  firstEventAt: string;
}

/** A job as its owning table knows it, independent of any events. */
export interface JobRecord {
  jobId: string;
  jobKind: ExecutionJobKind;
  status: ExecutionJobStatus;
  title: string | null;
  createdAt: string;
}

export interface ExecutionStore {
  /** Runs and enhancements of a project, newest first. */
  jobRecords(projectId: string, limit: number): Promise<JobRecord[]>;
  jobRecord(projectId: string, jobId: string): Promise<JobRecord | null>;
  append(event: PublishExecutionEventInput): Promise<ExecutionEvent>;
  list(jobId: string, afterSeq: number, limit: number): Promise<ExecutionEvent[]>;
  statsForProject(projectId: string): Promise<JobEventStats[]>;
  jobProject(jobId: string): Promise<string | null>;
  recordUsage(input: RecordStageUsageInput): Promise<StageUsageRecord>;
  listUsage(jobId: string): Promise<StageUsageRecord[]>;
  /** Recently started jobs with no terminal event, newest first. */
  unsettledJobs(limit: number): Promise<UnsettledJob[]>;
}

export interface UnsettledJob {
  jobId: string;
  jobKind: ExecutionJobKind;
  projectId: string;
}

type EventRow = Awaited<ReturnType<typeof prisma.executionEvent.create>>;
type UsageRow = Awaited<ReturnType<typeof prisma.stageUsage.create>>;

function toEvent(row: EventRow): ExecutionEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    jobKind: row.jobKind,
    jobId: row.jobId,
    seq: row.seq,
    type: row.type,
    status: row.status,
    stage: row.stage,
    agentId: row.agentId,
    message: row.message,
    data: (row.data ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toUsage(row: UsageRow): StageUsageRecord {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** The tables speak different status vocabularies; the timeline speaks one. */
const RUN_STATUS: Record<string, ExecutionJobStatus> = {
  PENDING: 'queued',
  ANALYZING: 'running',
  PLANNING: 'running',
  GENERATING: 'running',
  REVIEWING: 'running',
  COMPLETED: 'succeeded',
  FAILED: 'failed',
};
const EDIT_STATUS: Record<string, ExecutionJobStatus> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  REJECTED: 'rejected',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  CANCELLED: 'cancelled',
};

interface RunShape {
  id: string;
  status: string;
  prompt: string;
  createdAt: Date | string;
}

function runRecord(row: RunShape): JobRecord {
  return {
    jobId: row.id,
    jobKind: 'RUN',
    status: RUN_STATUS[row.status] ?? 'unknown',
    title: row.prompt,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

interface EditShape {
  id: string;
  status: string;
  instruction: string;
  createdAt: Date;
}

function enhancementRecord(row: EditShape): JobRecord {
  return {
    jobId: row.id,
    jobKind: 'ENHANCEMENT',
    status: EDIT_STATUS[row.status] ?? 'unknown',
    title: row.instruction,
    createdAt: row.createdAt.toISOString(),
  };
}

const SEQ_RETRIES = 5;

export const databaseStore: ExecutionStore = {
  async jobRecords(projectId, limit) {
    const [runs, enhancements] = await Promise.all([
      prisma.generation.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.editJob.findMany({
        // Every kind: a plain edit now publishes events too, and without its
        // own record it would be listed as an 'unknown' job with no title.
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    return [...runs.map(runRecord), ...enhancements.map(enhancementRecord)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },

  async jobRecord(projectId, jobId) {
    const run = await prisma.generation.findFirst({ where: { id: jobId, projectId } });
    if (run) return runRecord(run);
    // Any kind: a plain edit stores usage rows under its id too.
    const job = await prisma.editJob.findFirst({ where: { id: jobId, projectId } });
    return job ? enhancementRecord(job) : null;
  },

  async append(event) {
    // The service serialises publishes per job in this process. The retry
    // covers what that cannot see: a restart or a second process mid-job.
    for (let attempt = 0; ; attempt += 1) {
      const last = await prisma.executionEvent.findFirst({
        where: { jobId: event.jobId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      try {
        const row = await prisma.executionEvent.create({
          data: {
            projectId: event.projectId,
            jobKind: event.jobKind,
            jobId: event.jobId,
            seq: (last?.seq ?? 0) + 1,
            type: event.type,
            status: event.status ?? null,
            stage: event.stage ?? null,
            agentId: event.agentId ?? null,
            message: event.message,
            ...(event.data === undefined ? {} : { data: event.data as Prisma.InputJsonObject }),
          },
        });
        return toEvent(row);
      } catch (error) {
        const conflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!conflict || attempt >= SEQ_RETRIES) throw error;
      }
    }
  },

  async list(jobId, afterSeq, limit) {
    const rows = await prisma.executionEvent.findMany({
      where: { jobId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map(toEvent);
  },

  async statsForProject(projectId) {
    const groups = await prisma.executionEvent.groupBy({
      by: ['jobId', 'jobKind'],
      where: { projectId },
      _count: { _all: true },
      _max: { seq: true, createdAt: true },
      _min: { createdAt: true },
    });
    return groups.map((group) => ({
      jobId: group.jobId,
      jobKind: group.jobKind,
      eventCount: group._count._all,
      lastSeq: group._max.seq ?? 0,
      lastEventAt: (group._max.createdAt ?? new Date(0)).toISOString(),
      firstEventAt: (group._min.createdAt ?? new Date(0)).toISOString(),
    }));
  },

  async unsettledJobs(limit) {
    const started = await prisma.executionEvent.findMany({
      where: { type: 'job.started' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { jobId: true, jobKind: true, projectId: true },
    });
    const ended = await prisma.executionEvent.findMany({
      where: {
        type: { in: [...TERMINAL_EVENT_TYPES] },
        jobId: { in: started.map((row) => row.jobId) },
      },
      select: { jobId: true },
    });
    const settled = new Set(ended.map((row) => row.jobId));
    return started.filter((row) => !settled.has(row.jobId));
  },

  async jobProject(jobId) {
    const row = await prisma.executionEvent.findFirst({
      where: { jobId },
      select: { projectId: true },
    });
    return row?.projectId ?? null;
  },

  async recordUsage(input) {
    const row = await prisma.stageUsage.create({
      data: {
        projectId: input.projectId,
        jobId: input.jobId,
        stage: input.stage,
        agentId: input.agentId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        costUsd: input.costUsd ?? null,
        durationMs: Math.round(input.durationMs),
      },
    });
    return toUsage(row);
  },

  async listUsage(jobId) {
    const rows = await prisma.stageUsage.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toUsage);
  },
};

/** Memory is bounded: no-database mode has no retention to fall back on. */
const MEMORY_JOB_LIMIT = 100;

export function createMemoryStore(): ExecutionStore {
  const events = new Map<string, ExecutionEvent[]>();
  const usage = new Map<string, StageUsageRecord[]>();
  let nextId = 1;

  return {
    unsettledJobs(limit) {
      const unsettled = [...events.values()]
        .filter(
          (list) =>
            list.some((event) => event.type === 'job.started') &&
            !list.some((event) => isTerminalEventType(event.type)),
        )
        .reverse()
        .slice(0, limit)
        .flatMap((list) => {
          const first = list[0];
          return first === undefined
            ? []
            : [{ jobId: first.jobId, jobKind: first.jobKind, projectId: first.projectId }];
        });
      return Promise.resolve(unsettled);
    },
    jobRecords(projectId, limit) {
      return Promise.resolve(memGenerationsForProject(projectId).slice(0, limit).map(runRecord));
    },
    jobRecord(projectId, jobId) {
      const run = memGenerationsForProject(projectId).find((row) => row.id === jobId);
      return Promise.resolve(run ? runRecord(run) : null);
    },
    append(event) {
      if (!events.has(event.jobId) && events.size >= MEMORY_JOB_LIMIT) {
        const oldest = events.keys().next().value;
        if (oldest !== undefined) {
          events.delete(oldest);
          usage.delete(oldest);
        }
      }
      const list = events.get(event.jobId) ?? [];
      const stored: ExecutionEvent = {
        id: `mem_${String(nextId++)}`,
        projectId: event.projectId,
        jobKind: event.jobKind,
        jobId: event.jobId,
        seq: list.length + 1,
        type: event.type,
        status: event.status ?? null,
        stage: event.stage ?? null,
        agentId: event.agentId ?? null,
        message: event.message,
        data: event.data ?? null,
        createdAt: new Date().toISOString(),
      };
      list.push(stored);
      events.set(event.jobId, list);
      return Promise.resolve(stored);
    },
    list(jobId, afterSeq, limit) {
      return Promise.resolve(
        (events.get(jobId) ?? []).filter((event) => event.seq > afterSeq).slice(0, limit),
      );
    },
    statsForProject(projectId) {
      const stats: JobEventStats[] = [];
      for (const [jobId, list] of events) {
        const first = list[0];
        const last = list[list.length - 1];
        if (!first || !last || first.projectId !== projectId) continue;
        stats.push({
          jobId,
          jobKind: first.jobKind,
          eventCount: list.length,
          lastSeq: last.seq,
          lastEventAt: last.createdAt,
          firstEventAt: first.createdAt,
        });
      }
      return Promise.resolve(stats);
    },
    jobProject(jobId) {
      return Promise.resolve(events.get(jobId)?.[0]?.projectId ?? null);
    },
    recordUsage(input) {
      const stored: StageUsageRecord = {
        id: `mem_${String(nextId++)}`,
        projectId: input.projectId,
        jobId: input.jobId,
        stage: input.stage,
        agentId: input.agentId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        costUsd: input.costUsd ?? null,
        durationMs: Math.round(input.durationMs),
        createdAt: new Date().toISOString(),
      };
      usage.set(input.jobId, [...(usage.get(input.jobId) ?? []), stored]);
      return Promise.resolve(stored);
    },
    listUsage(jobId) {
      return Promise.resolve(usage.get(jobId) ?? []);
    },
  };
}

export function defaultStore(): ExecutionStore {
  return config.database.enabled ? databaseStore : createMemoryStore();
}

const PRUNE_JOB_BATCH = 500;

/**
 * Removes timelines that have ended and aged out, one bounded batch per boot.
 *
 * A job with a surviving `edit_jobs` row keeps its timeline: that row is still
 * shown, and the edit-job sweep deletes the two together. Anything else past
 * the window, including timelines an earlier sweep orphaned, goes.
 */
export async function pruneExecutionHistory(now: Date = new Date()): Promise<void> {
  if (!config.database.enabled) return;
  const cutoff = new Date(now.getTime() - config.editJobs.eventRetentionDays * 24 * 60 * 60_000);
  try {
    const aged = await prisma.executionEvent.groupBy({
      by: ['jobId'],
      having: { createdAt: { _max: { lt: cutoff } } },
      orderBy: { jobId: 'asc' },
      take: PRUNE_JOB_BATCH,
    });
    const candidates = aged.map((entry) => entry.jobId);
    if (candidates.length === 0) return;
    const kept = await prisma.editJob.findMany({
      where: { id: { in: candidates } },
      select: { id: true },
    });
    const keptIds = new Set(kept.map((row) => row.id));
    const doomed = candidates.filter((jobId) => !keptIds.has(jobId));
    if (doomed.length === 0) return;
    await prisma.$transaction([
      prisma.executionEvent.deleteMany({ where: { jobId: { in: doomed } } }),
      prisma.stageUsage.deleteMany({ where: { jobId: { in: doomed } } }),
    ]);
    logger.info('pruned aged execution timelines', { jobs: doomed.length });
  } catch (error) {
    // Housekeeping must never be the reason a boot fails.
    logger.warn('execution timelines could not be pruned', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
