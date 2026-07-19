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

export const apiRateLimiter: RequestHandler = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) => {
    const body: ApiFailure = {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests — please retry later',
      },
      meta: { requestId: req.id },
    };
    res.status(429).json(body);
  },
});
