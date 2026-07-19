/**
 * Success-envelope helper.
 *
 * Route handlers call `sendSuccess` instead of `res.json` so every 2xx
 * response carries the same shape and the request correlation id without any
 * handler remembering to add it. (Failures never call this — they throw or
 * `next()` an AppError and the central error handler builds the envelope.)
 */
import type { Response } from 'express';

import type { ApiSuccess } from '../types/api.js';

interface SendSuccessOptions {
  status?: number;
  meta?: Record<string, unknown>;
}

export function sendSuccess(res: Response, data: unknown, options: SendSuccessOptions = {}): void {
  const { status = 200, meta } = options;

  const body: ApiSuccess<unknown> = {
    success: true,
    data,
    meta: {
      requestId: res.req.id,
      ...meta,
    },
  };

  res.status(status).json(body);
}
