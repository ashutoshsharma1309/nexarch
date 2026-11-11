/**
 * HTTP for execution history. Every route answers only for a project the
 * caller owns, and a job outside that project is a plain 404: the same
 * answer as a job that does not exist.
 */
import type { Request, RequestHandler, Response } from 'express';

import { config } from '../../shared/config/index.js';
import { logger } from '../../shared/logger/index.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { getArtifacts, getRun } from '../pipeline/pipeline.service.js';
import { loadRunArtifactsForProject } from '../pipeline/lib/run-artifact-store.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import type { PipelineArtifacts } from '../pipeline/pipeline.types.js';
import { isTerminalEventType } from './execution-events.types.js';
import type { ExecutionEvent } from './execution-events.types.js';
import {
  findJobRecord,
  jobBelongsToProject,
  listExecutionEvents,
  listExecutionJobs,
  listStageUsage,
  subscribeToExecutionEvents,
} from './execution-events.service.js';

/** Under the 30-60s idle cut-off of common proxies. */
const HEARTBEAT_MS = 15_000;
/**
 * How long a settled job may stay quiet before its stream is closed without
 * a terminal event. Jobs settle their row around the same time they publish
 * their last event, so closing the moment the row says "done" could cut off
 * the final lines. Also what ends streams on jobs from before events existed.
 */
const SETTLE_GRACE_MS = 30_000;
const ENDED_STATUSES = new Set(['succeeded', 'rejected', 'failed', 'cancelled', 'interrupted']);

export interface ExecutionHandlerDeps {
  assertOwned: (ownerId: string, projectId: string) => Promise<void>;
  loadResearch: (ownerId: string, projectId: string, runId: string) => Promise<unknown>;
  heartbeatMs: number;
  settleGraceMs: number;
}

function ownerOf(req: Request): string {
  if (!req.user) throw AppError.internal('ownerOf called on an unguarded route');
  return req.user.id;
}

const openStreams = new Set<() => void>();

/**
 * Ends every stream so a shutdown is not held open by them. No `end` frame:
 * the job is not over, and a client that reconnects resumes from its cursor.
 */
export function closeExecutionStreams(): void {
  for (const close of [...openStreams]) close();
}

function param(req: Request, name: string): string {
  return req.params[name] as string;
}

function parseCursor(raw: unknown): number {
  if (raw === undefined || raw === '') return 0;
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) {
    throw AppError.badRequest(
      '`after` must be a whole number, the seq of the last event you hold.',
    );
  }
  return Number(raw);
}

/**
 * The research for a run, scoped to the project in the URL. The by-run-id
 * read cannot be used alone for this: a run no longer in memory is loaded by
 * id with no owner check, so the project has to be part of the lookup.
 */
async function defaultLoadResearch(
  ownerId: string,
  projectId: string,
  runId: string,
): Promise<unknown> {
  let artifacts: PipelineArtifacts | null;
  if (config.database.enabled) {
    artifacts = await loadRunArtifactsForProject(runId, projectId);
  } else {
    artifacts =
      getRun(runId, ownerId).projectId === projectId ? getArtifacts(runId, ownerId) : null;
  }
  if (!artifacts) throw AppError.notFound(`Run "${runId}" has no stored output in this project`);
  // Null for runs from before research existed: absent, not empty.
  return artifacts.research ?? null;
}

const defaults: ExecutionHandlerDeps = {
  assertOwned: async (ownerId, projectId) => {
    await getProjectOrThrow(ownerId, projectId);
  },
  loadResearch: defaultLoadResearch,
  heartbeatMs: HEARTBEAT_MS,
  settleGraceMs: SETTLE_GRACE_MS,
};

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/** Handlers built from their dependencies, so tests can supply the owner check. */
export function createExecutionHandlers(
  overrides: Partial<ExecutionHandlerDeps> = {},
): Record<'jobs' | 'events' | 'usage' | 'research' | 'stream', RequestHandler> {
  const deps: ExecutionHandlerDeps = { ...defaults, ...overrides };

  async function authorizedJob(req: Request): Promise<{ projectId: string; jobId: string }> {
    const projectId = param(req, 'projectId');
    const jobId = param(req, 'jobId');
    await deps.assertOwned(ownerOf(req), projectId);
    if (!(await jobBelongsToProject(projectId, jobId))) {
      throw AppError.notFound(`Execution "${jobId}" not found`);
    }
    return { projectId, jobId };
  }

  const jobs = asyncHandler(async (req, res) => {
    const projectId = param(req, 'projectId');
    await deps.assertOwned(ownerOf(req), projectId);
    sendSuccess(res, await listExecutionJobs(projectId));
  });

  const events = asyncHandler(async (req, res) => {
    const { jobId } = await authorizedJob(req);
    sendSuccess(res, await listExecutionEvents(jobId, parseCursor(req.query.after)));
  });

  const usage = asyncHandler(async (req, res) => {
    const { jobId } = await authorizedJob(req);
    sendSuccess(res, await listStageUsage(jobId));
  });

  const research = asyncHandler(async (req, res) => {
    const runId = param(req, 'runId');
    const projectId = param(req, 'projectId');
    const owner = ownerOf(req);
    await deps.assertOwned(owner, projectId);
    sendSuccess(res, { runId, research: await deps.loadResearch(owner, projectId, runId) });
  });

  const stream = asyncHandler(async (req, res) => {
    // A client can leave during these reads, and 'close' will not fire twice.
    const client = { left: false };
    const onEarlyClose = (): void => {
      client.left = true;
    };
    res.once('close', onEarlyClose);
    const { projectId, jobId } = await authorizedJob(req);
    res.off('close', onEarlyClose);
    if (client.left) return;

    const header = req.headers['last-event-id'];
    let cursor = parseCursor(typeof header === 'string' ? header : req.query.after);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // `no-transform` is what keeps the app-wide compression middleware from
    // buffering the stream; X-Accel-Buffering does the same for nginx.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    // An object, because these change inside callbacks the compiler cannot
    // follow: as `let`s it narrows them to their initial values.
    const state = {
      open: true,
      replaying: true,
      lastEventAt: 0,
      heartbeat: null as NodeJS.Timeout | null,
    };
    const pending: ExecutionEvent[] = [];

    function close(): void {
      if (!state.open) return;
      state.open = false;
      openStreams.delete(close);
      if (state.heartbeat) clearInterval(state.heartbeat);
      unsubscribe();
      res.end();
    }
    openStreams.add(close);

    function finish(reason: string): void {
      if (!state.open) return;
      res.write(`event: end\ndata: ${JSON.stringify({ reason, lastSeq: cursor })}\n\n`);
      close();
    }

    function send(event: ExecutionEvent): void {
      // The boundary between replay and live can deliver an event twice.
      if (!state.open || event.seq <= cursor) return;
      cursor = event.seq;
      state.lastEventAt = Date.parse(event.createdAt);
      res.write(`id: ${String(event.seq)}\nevent: execution\ndata: ${JSON.stringify(event)}\n\n`);
      if (isTerminalEventType(event.type)) finish('terminal-event');
    }

    // Subscribed before reading, so nothing published during replay is lost.
    const unsubscribe = subscribeToExecutionEvents(jobId, (event) => {
      if (state.replaying) pending.push(event);
      else send(event);
    });
    // On the response, not the request: since Node 16 a request's `close`
    // means its body was read, which says nothing about the connection.
    res.on('close', close);

    async function settledWithoutTerminal(): Promise<boolean> {
      const record = await findJobRecord(projectId, jobId);
      if (!record || !ENDED_STATUSES.has(record.status)) return false;
      return state.lastEventAt === 0 || Date.now() - state.lastEventAt >= deps.settleGraceMs;
    }

    try {
      for (;;) {
        const page = await listExecutionEvents(jobId, cursor);
        for (const event of page) send(event);
        if (!state.open || page.length === 0) break;
      }
      state.replaying = false;
      pending.splice(0).forEach(send);
      if (state.open && (await settledWithoutTerminal())) finish('job-settled');
    } catch (error) {
      // Headers are gone, so the error handler can no longer answer. The
      // client reconnects with its cursor, which is exactly the right retry.
      logger.warn('execution stream replay failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      close();
      return;
    }
    if (!state.open) return;

    state.heartbeat = setInterval(() => {
      if (!state.open) return;
      res.write(': heartbeat\n\n');
      settledWithoutTerminal().then(
        (settled) => {
          if (settled) finish('job-settled');
        },
        () => undefined,
      );
    }, deps.heartbeatMs);
    state.heartbeat.unref();
  });

  return { jobs, events, usage, research, stream };
}
