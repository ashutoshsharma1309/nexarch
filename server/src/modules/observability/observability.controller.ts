/**
 * Reading the execution timeline.
 *
 * The events themselves are already in the log, which is where they are
 * durable. This surface exists because the log is not where anyone actually
 * answers "which stage took longest" — doing that from a file needs the
 * correlation id up front, the file to hand, and a parser. Here the grouping
 * and the arithmetic are already done.
 *
 * Two honest limits are part of the contract rather than hidden: a timeline
 * lives in this process, so a restart loses it and the log remains the
 * durable record; and only a bounded number of recent correlations is kept,
 * so an old one is simply absent rather than empty.
 */
import type { Request, Response } from 'express';

import { getTimeline, listTimelines } from '../../shared/logger/timeline.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';

function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

/**
 * Recent executions, newest activity first, summaries included.
 *
 * Scoped to the caller: a timeline carries no prompts and no generated
 * files, but it does carry run ids and timings, which belong to whoever did
 * the work.
 */
export function listTimelinesHandler(req: Request, res: Response): void {
  // `?projectId=` narrows to one project's executions. The server filters
  // because it is the only side that knows which project an edit job or a
  // preview session belonged to — their timelines are keyed by their own
  // ids, not by a run the client could recognise.
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const timelines = listTimelines(ownerOf(req), projectId);
  sendSuccess(res, {
    // Summaries only in the listing. The entries are the bulk, and the
    // caller that lists is about to ask for exactly one of them.
    timelines: timelines.map((timeline) => ({
      key: timeline.key,
      startedAt: timeline.startedAt,
      updatedAt: timeline.updatedAt,
      events: timeline.entries.length,
      truncated: timeline.truncated,
      summary: timeline.summary,
    })),
    /** Said out loud so a caller never reads an absent timeline as "nothing happened". */
    retention: 'in-memory, bounded, lost on restart — the server log is the durable record',
  });
}

export function getTimelineHandler(req: Request, res: Response): void {
  const key = req.params.key as string;
  const timeline = getTimeline(key, ownerOf(req));
  // Not-recorded, evicted and not-yours all read the same, as everywhere
  // else in this API.
  if (!timeline) {
    throw AppError.notFound(
      'No timeline is held for that id. Timelines are kept in memory for recent executions only; the server log is the durable record.',
    );
  }
  sendSuccess(res, timeline);
}
