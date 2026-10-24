/**
 * The durable record of an edit in progress.
 *
 * Applying an edit is minutes of real work, so it outlives the request that
 * asked for it. This is the only thing the client can trust in the meantime:
 * the in-memory plan is gone after a restart, the runner session is gone with
 * it, but the row saying "this project has an edit running, and here is how
 * far it got" survives.
 *
 * Three rules it exists to enforce:
 *
 * - A job that was running when the process died is reported INTERRUPTED. Not
 *   succeeded, not failed — nothing can be known about how far it got, and
 *   guessing in either direction misleads the user about what their project
 *   now contains.
 * - One active job per project. Two edits applying at once would race over
 *   the same baseline and the loser's work would vanish without a word.
 * - Stages are recorded with their own timestamps, so elapsed time is
 *   measured rather than animated.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '../../../shared/database/prisma.js';
import { logger } from '../../../shared/logger/index.js';
import type { EditResult } from '../project-editor.types.js';

/**
 * An error as a string a log line can carry.
 *
 * `Error.message` and `.stack` are non-enumerable, so an Error passed as log
 * metadata walks as `{}` — every "could not record" line in this file was
 * publishing an empty object where its reason should be.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type EditJobStatus =
  'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'INTERRUPTED';

/** The stages an apply really goes through. No percentages, no invented steps. */
export const EDIT_STAGES = ['queued', 'rebuilding', 'validating', 'deciding', 'finished'] as const;
export type EditStage = (typeof EDIT_STAGES)[number];

export interface EditStageRecord {
  stage: EditStage;
  startedAt: string;
  completedAt: string | null;
  /** One line a user can read about what this stage did. */
  detail: string | null;
}

export interface EditJob {
  id: string;
  projectId: string;
  ownerId: string;
  planId: string;
  status: EditJobStatus;
  stage: EditStage;
  stages: EditStageRecord[];
  instruction: string;
  result: EditResult | null;
  error: string | null;
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Statuses that mean the job is over, whatever the outcome. */
const TERMINAL: EditJobStatus[] = ['SUCCEEDED', 'REJECTED', 'FAILED', 'INTERRUPTED'];

export function isTerminal(status: EditJobStatus): boolean {
  return TERMINAL.includes(status);
}

interface Row {
  id: string;
  projectId: string;
  ownerId: string;
  planId: string;
  status: string;
  stage: string;
  stages: unknown;
  instruction: string;
  result: unknown;
  error: string | null;
  runId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toJob(row: Row): EditJob {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerId: row.ownerId,
    planId: row.planId,
    status: row.status as EditJobStatus,
    stage: row.stage as EditStage,
    stages: Array.isArray(row.stages) ? (row.stages as EditStageRecord[]) : [],
    instruction: row.instruction,
    result: (row.result ?? null) as EditResult | null,
    error: row.error,
    runId: row.runId,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Prisma's JSON input type will not take a declared interface array, though
 * the records are plain JSON by construction. One named conversion, so the
 * cast is in a single place and says why it is safe.
 */
function asJson(records: EditStageRecord[]): Prisma.InputJsonValue {
  return records as unknown as Prisma.InputJsonValue;
}

/**
 * The job already running for this project, if any.
 *
 * Checked before starting another, because two applies against one baseline
 * would race: both rebuild from the same files, both validate, and whichever
 * finishes second silently overwrites the first.
 */
/**
 * How long a job may go without a heartbeat before it is presumed dead.
 *
 * Generous on purpose: the validating stage legitimately runs for minutes
 * without writing anything. This is the backstop for a job whose process
 * vanished in a way the boot sweep did not catch — a crash with no restart,
 * or a write that failed when it tried to record its own outcome — because
 * such a job would otherwise block every future edit of that project until
 * someone restarted the server.
 */
const STALE_AFTER_MS = 10 * 60_000;

/**
 * Prove a job is still being worked on.
 *
 * Without this, `updatedAt` only moved at stage boundaries, and the longest
 * honest stage — install, build, type-check, lint, boot — writes nothing for
 * minutes. Staleness was therefore a race against a worst-case arithmetic
 * (about 36 minutes against a 45-minute threshold) that nobody asserted and
 * a laptop suspend or a slower machine could lose. Losing it was expensive:
 * a live job declared dead frees the project for a second apply, and the real
 * job's eventual verdict is then discarded as stale.
 *
 * With a heartbeat the question becomes "has anything touched this in ten
 * minutes", which is answerable without knowing how long the work should
 * take.
 */
export async function heartbeat(jobId: string): Promise<void> {
  try {
    await prisma.editJob.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { updatedAt: new Date() },
    });
  } catch (error) {
    logger.warn('edit job heartbeat failed', { jobId, error: describeError(error) });
  }
}

export async function activeJobFor(projectId: string): Promise<EditJob | null> {
  const row = await prisma.editJob.findFirst({
    where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;

  if (Date.now() - row.updatedAt.getTime() > STALE_AFTER_MS) {
    await finishJob(row.id, {
      status: 'INTERRUPTED',
      error:
        'This edit stopped reporting progress and was presumed dead. The project still has the files it had before it started.',
      detail: 'no heartbeat for ten minutes',
    });
    return null;
  }
  return toJob(row);
}

export class ActiveEditExists extends Error {}

/**
 * Create the job, or fail because one is already running.
 *
 * The uniqueness is the database's, not this function's: checking first and
 * creating second is a race that a double-click wins, and the losing request
 * would rebuild from the same baseline and have its work silently discarded.
 * A unique-violation here means another request won, which is exactly the
 * answer the caller needs.
 */
export async function createJob(input: {
  projectId: string;
  ownerId: string;
  planId: string;
  instruction: string;
}): Promise<EditJob> {
  const now = new Date().toISOString();
  try {
    const row = await prisma.editJob.create({
      data: {
        projectId: input.projectId,
        ownerId: input.ownerId,
        planId: input.planId,
        instruction: input.instruction,
        status: 'QUEUED',
        stage: 'queued',
        stages: asJson([{ stage: 'queued', startedAt: now, completedAt: null, detail: null }]),
      },
    });
    return toJob(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ActiveEditExists('An edit is already running for this project');
    }
    throw error;
  }
}

export async function getJob(jobId: string, ownerId: string): Promise<EditJob | null> {
  const row = await prisma.editJob.findUnique({ where: { id: jobId } });
  // Not-yours reads the same as not-found, as everywhere else in this API.
  if (row?.ownerId !== ownerId) return null;
  return toJob(row);
}

export async function latestJobFor(projectId: string, ownerId: string): Promise<EditJob | null> {
  const row = await prisma.editJob.findFirst({
    where: { projectId, ownerId },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toJob(row) : null;
}

/**
 * Close the stage in progress and open the next one.
 *
 * Both halves in one write: a reader polling between two writes would
 * otherwise see a job with no stage running at all.
 */
export async function advanceStage(
  jobId: string,
  next: EditStage,
  detail: string | null = null,
): Promise<void> {
  try {
    const row = await prisma.editJob.findUnique({ where: { id: jobId } });
    if (!row) return;
    const now = new Date().toISOString();
    const stages = (Array.isArray(row.stages) ? row.stages : []) as unknown as EditStageRecord[];
    const current = stages.at(-1);
    if (current?.completedAt === null) {
      current.completedAt = now;
      if (detail !== null) current.detail = detail;
    }
    stages.push({ stage: next, startedAt: now, completedAt: null, detail: null });

    // Guarded on a non-terminal status: a job that was already settled —
    // swept as INTERRUPTED by a restart, say — must not be resurrected to
    // RUNNING by a straggling stage update, which would both contradict what
    // the user was told and let a second edit start alongside this one.
    const updated = await prisma.editJob.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        stage: next,
        stages: asJson(stages),
        status: 'RUNNING',
        ...(row.startedAt === null ? { startedAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) {
      logger.warn('stage update ignored: the job was already settled', { jobId, next });
    }
  } catch (error) {
    // A job that cannot report its progress is still a job worth finishing.
    logger.warn('edit job stage could not be recorded', {
      jobId,
      next,
      error: describeError(error),
    });
  }
}

export async function finishJob(
  jobId: string,
  outcome: {
    status: Exclude<EditJobStatus, 'QUEUED' | 'RUNNING'>;
    result?: EditResult | null;
    error?: string | null;
    runId?: string | null;
    detail?: string | null;
  },
): Promise<void> {
  try {
    const row = await prisma.editJob.findUnique({ where: { id: jobId } });
    if (!row) return;
    const now = new Date().toISOString();
    const stages = (Array.isArray(row.stages) ? row.stages : []) as unknown as EditStageRecord[];
    const current = stages.at(-1);
    if (current?.completedAt === null) {
      current.completedAt = now;
      if (outcome.detail !== undefined && outcome.detail !== null) current.detail = outcome.detail;
    }
    stages.push({
      stage: 'finished',
      startedAt: now,
      completedAt: now,
      detail: outcome.detail ?? null,
    });

    const settled = await prisma.editJob.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        status: outcome.status,
        stage: 'finished',
        stages: asJson(stages),
        result: (outcome.result ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
        error: outcome.error ?? null,
        runId: outcome.runId ?? null,
        completedAt: new Date(),
      },
    });
    if (settled.count === 0) {
      // Something settled it first — the boot sweep, or the staleness
      // backstop. Its verdict stands; overwriting it would tell the user a
      // different story than the one they already read.
      logger.warn('edit job outcome ignored: it was already settled', {
        jobId,
        attempted: outcome.status,
      });
    }
  } catch (error) {
    logger.error('edit job outcome could not be recorded', { jobId, error: describeError(error) });
  }
}

/**
 * Settle jobs a previous process left running.
 *
 * Safe to run unconditionally at boot for the same reason the pipeline's
 * equivalent is: nothing has started executing in this process yet, so every
 * job still claiming to run belongs to a process that is gone. They are
 * marked INTERRUPTED rather than failed, because "it broke" and "nobody knows
 * how far it got" are different things to tell a user about their project.
 *
 * This is correct for exactly one server instance, which is how NexArch runs
 * and is deployed today. A second instance booting beside a live one would
 * sweep that instance's *running* jobs to INTERRUPTED, telling the user an
 * edit stopped while it was still going; the real job would then find itself
 * already settled and its verdict would be dropped (`finishJob` logs that).
 * Nothing here detects the situation, so horizontal scaling needs an instance
 * identity on the row — claim jobs by owner and sweep only your own — before
 * a second instance is started. The ten-minute heartbeat backstop in
 * `activeJobFor` is what keeps a project editable if this sweep is ever
 * removed for that reason.
 */
export async function reconcileInterruptedJobs(): Promise<number> {
  try {
    const { count } = await prisma.editJob.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        status: 'INTERRUPTED',
        error:
          'The server restarted while this edit was running. The edit was not applied — the project still has the files it had before it started — but check the project before editing again.',
        completedAt: new Date(),
      },
    });
    return count;
  } catch (error) {
    logger.warn('interrupted edit jobs could not be reconciled', { error: describeError(error) });
    return 0;
  }
}
