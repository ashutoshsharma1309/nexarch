/**
 * API rate limiting.
 *
 * A single conservative limiter guards the whole API surface in Phase 1.
 * Later phases add stricter per-route limiters (login attempts, generation
 * kicks) on top — composing limiters is why this exports a factory-shaped
 * constant rather than being buried in app wiring.
 */
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { config } from '../config/index.js';
import type { ApiFailure } from '../types/api.js';

function limited(
  message: string,
): (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => void {
  return (req, res) => {
    const body: ApiFailure = {
      success: false,
      error: { code: 'RATE_LIMITED', message },
      meta: { requestId: req.id },
    };
    res.status(429).json(body);
  };
}

/**
 * The reads the console polls while something is running: a run's status,
 * its log tail, the validation and intelligence summaries behind it.
 *
 * These are cheap, owner-scoped GETs, and a live preview issues two of them
 * a second for as long as `npm install` takes — more than the whole-API
 * budget allows in a minute. The casualty was never the poll itself: it was
 * `/auth/refresh` losing its slot to the flood and the console signing the
 * user out mid-run. So polling reads are metered on their own budget
 * (`pollingLimiter`) and skipped by the global one.
 */
const POLLED_READS: RegExp[] = [
  /^\/runner\/sessions(\/|$)/,
  /^\/projects\/[^/]+\/agent-runs(\/|$)/,
  /^\/projects\/[^/]+\/(findings|validation|repairs|engineering-review|intelligence)(\/|$)/,
  /^\/pipeline\/runs\/[^/]+$/,
  /^\/builder\/sessions(\/|$)/,
  // An edit runs for five or six minutes and the console polls its job the
  // whole time, plus one read of `jobs/current` on every page load. Left on
  // the global budget those polls alone can exhaust a minute's allowance,
  // and the first casualty is the same one named above: the session refresh
  // that keeps the user signed in while their edit finishes.
  /^\/projects\/[^/]+\/edits\/jobs(\/|$)/,
];

export function isPolledRead(req: Parameters<RequestHandler>[0]): boolean {
  return req.method === 'GET' && POLLED_READS.some((pattern) => pattern.test(req.path));
}

/**
 * Rotating the session is what keeps a signed-in user signed in. Spending
 * the shared budget elsewhere must never cost someone their session, so the
 * refresh endpoint is skipped here and bounded by its own limiter in the
 * auth router instead.
 */
export function isSessionRefresh(req: Parameters<RequestHandler>[0]): boolean {
  return req.method === 'POST' && req.path === '/auth/refresh';
}

export const apiRateLimiter: RequestHandler = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => config.isTest || isPolledRead(req) || isSessionRefresh(req),
  handler: limited('Too many requests — please retry later'),
});

/**
 * The polling budget. Generous enough for several live views at a poll every
 * two seconds, low enough that a runaway client is still stopped — and kept
 * separate so exhausting it can never cost a user their session.
 */
export const pollingLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: limited('Too many polling requests — slow down and retry.'),
});

/**
 * Expensive operations get their own, stricter budget (Step 19).
 *
 * An agent run installs a project and calls a model; a repair session runs
 * a real typecheck. These cost minutes and real tokens, so a handful per
 * window per client is the right ceiling — far below the read limit. The
 * limiter is keyed by authenticated user when there is one, falling back to
 * IP, so one tenant cannot exhaust the budget for everyone behind a proxy.
 */
export const expensiveOperationLimiter: RequestHandler = rateLimit({
  windowMs: 5 * 60_000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  keyGenerator: (req) => {
    const user = (req as { user?: { id?: string } }).user;
    return user?.id ?? req.ip ?? 'anonymous';
  },
  handler: limited(
    'This operation is expensive and rate limited — a few per minute. Please wait and retry.',
  ),
});
