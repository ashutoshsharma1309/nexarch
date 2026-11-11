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

import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { logger } from '../../../shared/logger/index.js';
import { logEvent } from '../../../shared/logger/events.js';
import { AppError } from '../../../shared/utils/app-error.js';
// The service file, not the module index, which would close an import loop.
import { publishExecutionEvent } from '../../execution-events/execution-events.service.js';
import type { EnhancementResult } from '../../enhancement/enhancement.types.js';
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
  'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';

/** The stages an apply really goes through. No percentages, no invented steps. */
export const EDIT_STAGES = ['queued', 'rebuilding', 'validating', 'deciding', 'finished'] as const;
export type EditStage = (typeof EDIT_STAGES)[number];

/**
 * The working phases of an enhancement, as stages under status RUNNING.
 *
 * Stages rather than statuses so the partial unique index (one active job per
 * project) and the restart sweep cover enhancements without learning a new
 * word. `researching` and `planning` happen before the job exists when the
 * plan is made first; they are listed because a job may still report them.
 */
export const ENHANCEMENT_STAGES = [
  'queued',
  'researching',
  'planning',
  'implementing',
  'testing',
  'repairing',
  'finished',
  'cancelled',
] as const;
export type EnhancementStage = (typeof ENHANCEMENT_STAGES)[number];

export type JobStage = EditStage | EnhancementStage;

/** Whether this row is a plain edit or an enhancement. Enhancements publish events. */
export type EditJobKind = 'EDIT' | 'ENHANCEMENT';

export interface EditStageRecord {
  stage: JobStage;
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
  kind: EditJobKind;
  /** The owner asked this job to stop. The worker honours it between steps. */
  cancelRequested: boolean;
  status: EditJobStatus;
  stage: JobStage;
  stages: EditStageRecord[];
  instruction: string;
  result: EditResult | EnhancementResult | null;
  error: string | null;
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Statuses that mean the job is over, whatever the outcome. */
const TERMINAL: EditJobStatus[] = ['SUCCEEDED', 'REJECTED', 'FAILED', 'INTERRUPTED', 'CANCELLED'];

/**
 * Statuses that mean the job is still someone's responsibility.
 *
 * Named once because this predicate is the one the partial unique index also
 * encodes (`WHERE status = ANY (ARRAY['QUEUED','RUNNING'])`), and it was
 * written out by hand in five separate queries in this file. A retention
 * sweep is exactly the wrong moment to discover that one of those five had
 * drifted from the index.
 */
const ACTIVE: EditJobStatus[] = ['QUEUED', 'RUNNING'];

export function isTerminal(status: EditJobStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Whether edit jobs can be durable at all.
 *
 * Every other store in the platform branches on this and degrades to memory;
 * this one reached straight for `prisma`, which in no-database mode is a
 * Proxy that throws on any property access. The guard is not cosmetic: the
 * whole point of the job row is to outlive the request, so where there is no
 * database the honest answer is to refuse the edit, not to start work whose
 * outcome has nowhere to go.
 */
const useDatabase = (): boolean => config.database.enabled;

/** Emits a lifecycle transition, so the row's history reaches the timeline. */
function published(
  job: { id: string; stage?: string },
  from: EditJobStatus,
  to: EditJobStatus,
  reason?: string,
): void {
  logEvent({
    event: 'job.transition',
    jobId: job.id,
    from,
    to,
    ...(job.stage === undefined ? {} : { stage: job.stage }),
    ...(reason === undefined ? {} : { reason }),
  });
}

interface Row {
  id: string;
  projectId: string;
  ownerId: string;
  planId: string;
  kind: string;
  cancelRequested: boolean;
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
    kind: row.kind === 'ENHANCEMENT' ? 'ENHANCEMENT' : 'EDIT',
    cancelRequested: row.cancelRequested,
    status: row.status as EditJobStatus,
    stage: row.stage as JobStage,
    stages: Array.isArray(row.stages) ? (row.stages as EditStageRecord[]) : [],
    instruction: row.instruction,
    result: (row.result ?? null) as EditResult | EnhancementResult | null,
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
  if (!useDatabase()) return;
  try {
    await prisma.editJob.updateMany({
      where: { id: jobId, status: { in: ACTIVE } },
      data: { updatedAt: new Date() },
    });
  } catch (error) {
    logger.warn('edit job heartbeat failed', { jobId, error: describeError(error) });
  }
}

export async function activeJobFor(projectId: string): Promise<EditJob | null> {
  if (!useDatabase()) return null;

  const row = await prisma.editJob.findFirst({
    where: { projectId, status: { in: ACTIVE } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;

  if (Date.now() - row.updatedAt.getTime() > STALE_AFTER_MS) {
    // Deliberately does NOT claim the project still has its previous files.
    // This path cannot know that: `applyEdit` persists the edited run before
    // `finishJob` is ever called, so a job that stopped reporting may have
    // already landed its changes. The old wording asserted the opposite and
    // would have told a user their project was untouched while they were
    // looking at an edited one.
    const settled = await finishJob(row.id, {
      status: 'INTERRUPTED',
      error:
        'This edit stopped reporting progress and was presumed dead. It is not known how far it got — check the project before editing again.',
      detail: 'no heartbeat for ten minutes',
    });
    // Only the caller that settled it may announce it: a concurrent caller, or
    // a job that finished between the read and the write, has nothing to report.
    if (settled) {
      void publishInterrupted(row.projectId, row.id, 'It stopped reporting progress.');
    }
    return null;
  }
  return toJob(row);
}

/** The terminal event for a job nobody is left to finish. Edits publish events too. */
async function publishInterrupted(
  projectId: string,
  jobId: string,
  message: string,
): Promise<void> {
  await publishExecutionEvent({
    projectId,
    jobKind: 'ENHANCEMENT',
    jobId,
    type: 'job.interrupted',
    status: 'failed',
    message: `This job was interrupted. ${message} It is not known how far it got.`,
    data: {},
  });
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
  /** Defaults to `EDIT`. Both kinds share the one active slot per project. */
  kind?: EditJobKind;
}): Promise<EditJob> {
  if (!useDatabase()) {
    // `conflict`, not `internal`: running without a database is a supported
    // mode, not a fault, and `internal` is non-operational — in production
    // the error handler replaces its message with a generic 500 and logs it
    // as a server error, so the user saw "Internal server error" for a
    // configuration the operator chose on purpose.
    throw AppError.conflict(
      'Edits need a database. The job record is what lets an edit outlive the request that started it, so this server is running with editing unavailable.',
    );
  }

  const now = new Date().toISOString();
  try {
    const row = await prisma.editJob.create({
      data: {
        projectId: input.projectId,
        ownerId: input.ownerId,
        planId: input.planId,
        instruction: input.instruction,
        kind: input.kind ?? 'EDIT',
        status: 'QUEUED',
        stage: 'queued',
        stages: asJson([{ stage: 'queued', startedAt: now, completedAt: null, detail: null }]),
      },
    });
    const job = toJob(row);
    logEvent({
      event: 'job.transition',
      jobId: job.id,
      from: 'none',
      to: 'QUEUED',
      stage: 'queued',
    });
    return job;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ActiveEditExists('An edit is already running for this project');
    }
    throw error;
  }
}

export async function getJob(jobId: string, ownerId: string): Promise<EditJob | null> {
  if (!useDatabase()) return null;
  const row = await prisma.editJob.findUnique({ where: { id: jobId } });
  // Not-yours reads the same as not-found, as everywhere else in this API.
  if (row?.ownerId !== ownerId) return null;
  return toJob(row);
}

export async function latestJobFor(
  projectId: string,
  ownerId: string,
  kind?: EditJobKind,
): Promise<EditJob | null> {
  if (!useDatabase()) return null;
  const row = await prisma.editJob.findFirst({
    where: { projectId, ownerId, ...(kind === undefined ? {} : { kind }) },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toJob(row) : null;
}

/**
 * Ask a job to stop. A flag, not a status: the work is still running until the
 * worker reaches a step boundary and stops itself.
 *
 * The status guard is what makes a cancel of a finished job an honest 409
 * rather than a flag set on a row nothing will read again.
 */
export async function requestCancel(jobId: string): Promise<boolean> {
  if (!useDatabase()) return false;
  const { count } = await prisma.editJob.updateMany({
    where: { id: jobId, status: { in: ACTIVE } },
    data: { cancelRequested: true },
  });
  return count > 0;
}

/** Read fresh at every step boundary, so a cancel from any tab is seen. */
export async function isCancelRequested(jobId: string): Promise<boolean> {
  if (!useDatabase()) return false;
  try {
    const row = await prisma.editJob.findUnique({
      where: { id: jobId },
      select: { cancelRequested: true },
    });
    return row?.cancelRequested ?? false;
  } catch (error) {
    // Failing to read the flag must not fail the job; the next boundary asks again.
    logger.warn('edit job cancel flag could not be read', { jobId, error: describeError(error) });
    return false;
  }
}

/**
 * Close the stage in progress and open the next one.
 *
 * Both halves in one write: a reader polling between two writes would
 * otherwise see a job with no stage running at all.
 */
export async function advanceStage(
  jobId: string,
  next: JobStage,
  detail: string | null = null,
): Promise<void> {
  if (!useDatabase()) return;
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
      where: { id: jobId, status: { in: ACTIVE } },
      data: {
        stage: next,
        stages: asJson(stages),
        status: 'RUNNING',
        ...(row.startedAt === null ? { startedAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) {
      logger.warn('stage update ignored: the job was already settled', { jobId, next });
      return;
    }
    // Emitted only after the write succeeded, so the timeline can never show
    // a transition the row did not actually take.
    published({ id: jobId, stage: next }, row.status, 'RUNNING');
    // The stage boundary in the same vocabulary the pipeline uses, so an
    // edit's stages and a build's stages read alike in one timeline.
    if (current?.completedAt === now) {
      const elapsed = Date.parse(now) - Date.parse(current.startedAt);
      logEvent({
        event: 'stage.end',
        stage: current.stage,
        outcome: 'completed',
        durationMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
        ...(detail === null ? {} : { reason: detail }),
      });
    }
    logEvent({ event: 'stage.start', stage: next });
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
    result?: EditResult | EnhancementResult | null;
    error?: string | null;
    runId?: string | null;
    detail?: string | null;
  },
): Promise<boolean> {
  if (!useDatabase()) return false;
  try {
    const row = await prisma.editJob.findUnique({ where: { id: jobId } });
    if (!row) return false;
    const now = new Date().toISOString();
    const stages = (Array.isArray(row.stages) ? row.stages : []) as unknown as EditStageRecord[];
    const current = stages.at(-1);
    if (current?.completedAt === null) {
      current.completedAt = now;
      if (outcome.detail !== undefined && outcome.detail !== null) current.detail = outcome.detail;
    }
    const closing: JobStage = outcome.status === 'CANCELLED' ? 'cancelled' : 'finished';
    stages.push({
      stage: closing,
      startedAt: now,
      completedAt: now,
      detail: outcome.detail ?? null,
    });

    const settled = await prisma.editJob.updateMany({
      where: { id: jobId, status: { in: ACTIVE } },
      data: {
        status: outcome.status,
        stage: closing,
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
      return false;
    }
    published(
      { id: jobId, stage: closing },
      row.status,
      outcome.status,
      outcome.detail ?? outcome.error ?? undefined,
    );
    // A rejected edit put the project back the way it was. That is a
    // rollback, and it is the answer to "why did my edit not take effect".
    if (outcome.status === 'REJECTED') {
      logEvent({
        event: 'rollback',
        target: `project ${row.projectId}`,
        outcome: 'restored',
        reason: outcome.detail ?? 'the edit did not pass validation',
      });
    }
    return true;
  } catch (error) {
    logger.error('edit job outcome could not be recorded', { jobId, error: describeError(error) });
    return false;
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
  if (!useDatabase()) return 0;
  try {
    // Read first: `updateMany` does not say which rows it moved, and each
    // job among them owes its stream exactly one terminal event.
    const interrupted = await prisma.editJob.findMany({
      where: { status: { in: ACTIVE } },
      select: { id: true, projectId: true },
    });
    const { count } = await prisma.editJob.updateMany({
      where: { status: { in: ACTIVE } },
      data: {
        status: 'INTERRUPTED',
        // Deliberately does not say the project is unchanged. `applyEdit`
        // persists the edited run before `finishJob` is reached, so a restart
        // late in an apply may well have landed the changes. The sibling
        // staleness path in `activeJobFor` stopped claiming it; this one was
        // still asserting it, which is the same false statement about a
        // user's own project.
        error:
          'The server restarted while this edit was running. It is not known how far it got — check the project before editing again.',
        completedAt: new Date(),
      },
    });
    for (const job of interrupted) {
      void publishInterrupted(job.projectId, job.id, 'The server restarted while it was running.');
    }
    return count;
  } catch (error) {
    logger.warn('interrupted edit jobs could not be reconciled', { error: describeError(error) });
    return 0;
  }
}

/* ── Retention ────────────────────────────────────────────────────────── */

/**
 * How many rows one sweep may delete.
 *
 * Bounded so the sweep is a known, small amount of work rather than however
 * much has accumulated: a first run against a year of history must not hold
 * a transaction open or load the backlog into memory. Whatever is left over
 * is deleted by the next sweep, which is why this is safe to call repeatedly.
 */
const PRUNE_BATCH = 500;

/**
 * How many windows one sweep will walk past before giving up for now.
 *
 * Only windows made entirely of rows that must be kept cost a pass, so this
 * is a bound on wasted work rather than on deletions. Five hundred kept rows
 * per pass means a deployment would need more than five thousand projects
 * whose only edit is ancient before a sweep stopped reaching deletable
 * history, and it reports `more: true` when it bails so the next one
 * continues.
 */
const MAX_PRUNE_PASSES = 10;

export interface PruneResult {
  /** Rows actually deleted. */
  removed: number;
  /** True when the batch filled, so there is more to do on the next sweep. */
  more: boolean;
  /** Set when the sweep itself could not run, so a caller can say so. */
  error: string | null;
}

/**
 * Deletes finished edit jobs that are past the retention window.
 *
 * What this will not do, by construction rather than by care:
 *
 * - It cannot delete a live job. The predicate selects `status IN TERMINAL`
 *   and `completedAt` not null, so a QUEUED or RUNNING row is not a
 *   candidate — including the one the partial unique index is protecting. A
 *   job that is merely stale is still active, and still safe.
 * - It cannot leave a project with no edit history. The newest finished job
 *   of every project in the batch is excluded, however old it is, so
 *   "what was the last thing that happened to this project" survives any
 *   retention window.
 * - It deletes nothing but `edit_jobs` rows. No project, artifact, run or
 *   graph record is touched. Nothing in the schema references `edit_jobs`,
 *   so no other row is left pointing at a deleted one — the FK-shaped
 *   columns on this table all point outwards.
 *
 * Safe to retry: deletes are by primary key, so a repeat deletes nothing a
 * second time, and a crash half way leaves the remainder for the next call.
 *
 * `batchSize` exists so a test can reproduce the window-full case with a
 * handful of rows instead of five hundred. Production never passes it.
 */
export async function pruneTerminalEditJobs(
  now: Date = new Date(),
  batchSize: number = PRUNE_BATCH,
): Promise<PruneResult> {
  if (!useDatabase()) return { removed: 0, more: false, error: null };

  const cutoff = new Date(now.getTime() - config.editJobs.retentionDays * 24 * 60 * 60_000);

  try {
    // Paged, not a single window.
    //
    // The rows this sweep must never delete — each project's newest finished
    // edit — are permanent residents of the oldest end of the table. A single
    // oldest-first batch therefore fills up with them once enough projects
    // have one, and the sweep then deletes nothing, for ever, while reporting
    // that there was nothing to do. Walking forward past a batch that was
    // entirely keepers is what makes progress possible.
    const examined = new Set<string>();
    let cursor: Date | null = null;
    let doomed: string[] = [];
    let candidateCount = 0;
    let doomedProjects = 0;

    for (let pass = 0; pass < MAX_PRUNE_PASSES; pass += 1) {
      const candidates: { id: string; projectId: string; completedAt: Date | null }[] =
        await prisma.editJob.findMany({
          where: {
            status: { in: TERMINAL },
            completedAt: { not: null, lt: cutoff, ...(cursor === null ? {} : { gte: cursor }) },
          },
          orderBy: { completedAt: 'asc' },
          take: batchSize,
          select: { id: true, projectId: true, completedAt: true },
        });
      const fresh = candidates.filter((row) => !examined.has(row.id));
      if (fresh.length === 0) return { removed: 0, more: false, error: null };
      for (const row of fresh) examined.add(row.id);
      candidateCount = candidates.length;

      // The newest finished job per project, for the projects in this batch
      // only — one query, not one per project.
      const projectIds = [...new Set(fresh.map((row) => row.projectId))];
      const newest = await prisma.editJob.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, status: { in: TERMINAL } },
        _max: { completedAt: true },
      });
      const keepPerProject = new Map(
        newest.map((row) => [row.projectId, row._max.completedAt?.getTime() ?? null]),
      );

      doomed = fresh
        .filter((row) => {
          const newestAt = keepPerProject.get(row.projectId);
          // Ties keep both rather than risking the survivor: erring towards
          // keeping a row is always the recoverable direction here.
          return newestAt === null || newestAt === undefined
            ? false
            : (row.completedAt?.getTime() ?? 0) !== newestAt;
        })
        .map((row) => row.id);

      if (doomed.length > 0) {
        doomedProjects = projectIds.length;
        break;
      }

      // Every row in that window is one we must keep. Move the cursor to the
      // end of it and look further forward rather than asking again.
      const last = fresh[fresh.length - 1]?.completedAt ?? null;
      if (last === null) return { removed: 0, more: false, error: null };
      cursor = last;
      if (candidates.length < batchSize) return { removed: 0, more: false, error: null };
    }

    if (doomed.length === 0) {
      // Bounded out: there is more to look at, and the next sweep will.
      return { removed: 0, more: true, error: null };
    }

    // Together, so a pruned job cannot leave a timeline with no job behind it.
    const [{ count }] = await prisma.$transaction([
      prisma.editJob.deleteMany({ where: { id: { in: doomed } } }),
      prisma.executionEvent.deleteMany({ where: { jobId: { in: doomed } } }),
      prisma.stageUsage.deleteMany({ where: { jobId: { in: doomed } } }),
    ]);
    logEvent({
      event: 'cleanup',
      target: 'edit_jobs',
      outcome: count > 0 ? 'removed' : 'skipped',
      reason: `older than ${String(config.editJobs.retentionDays)} days`,
    });
    // Counts and the window only: an instruction or a stored diff has no
    // business in a cleanup line.
    logger.info('pruned finished edit jobs', {
      removed: count,
      retentionDays: config.editJobs.retentionDays,
      projects: doomedProjects,
    });
    return { removed: count, more: candidateCount === batchSize, error: null };
  } catch (error) {
    // Retention is maintenance. It must never be the reason a boot fails or
    // an edit cannot start.
    const message = describeError(error);
    logger.warn('finished edit jobs could not be pruned', { error: message });
    return { removed: 0, more: false, error: message };
  }
}
