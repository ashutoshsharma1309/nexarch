/**
 * Validation layer.
 *
 * Wraps express-validator chains into a single middleware that either passes
 * a clean request through or forwards a 422 AppError with field-level
 * details. Route files declare *what* is valid; how violations become HTTP
 * responses is decided exactly once, here.
 *
 * Usage:
 *   router.post('/', validate([body('name').isString().notEmpty()]), handler);
 */
import { validationResult } from 'express-validator';
import type { ValidationChain } from 'express-validator';
import type { RequestHandler } from 'express';

import { AppError } from '../utils/app-error.js';
import type { ApiErrorDetail } from '../types/api.js';

export function validate(chains: readonly ValidationChain[]): RequestHandler {
  return async (req, _res, next) => {
    await Promise.all(chains.map((chain) => chain.run(req)));

    const result = validationResult(req);
    if (result.isEmpty()) {
      next();
      return;
    }

    const details: ApiErrorDetail[] = result.array().map((error) => ({
      field: error.type === 'field' ? error.path : error.type,
      message: typeof error.msg === 'string' ? error.msg : 'Invalid value',
    }));

    next(AppError.validationFailed('Request validation failed', details));
  };
}
