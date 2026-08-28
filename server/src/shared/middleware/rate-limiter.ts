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

export const apiRateLimiter: RequestHandler = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: limited('Too many requests — please retry later'),
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
