/**
 * Central error handling — the only place errors become HTTP responses.
 *
 * Everything upstream throws (Express 5 forwards rejected promises here
 * automatically) or calls `next(err)`. Errors are normalized to AppError:
 * known Prisma failures map to meaningful statuses, everything unexpected
 * becomes an opaque 500. Clients always receive the ApiFailure envelope;
 * internals (stack traces, driver messages) never leave the process in
 * production.
 */
import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { audit } from '../security/audit.js';
import { AppError } from '../utils/app-error.js';
import type { ApiFailure } from '../types/api.js';

/** Terminal 404 for routes no module claimed. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} does not exist`));
};

function normalizeError(error: unknown): AppError {
  if (AppError.isAppError(error)) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return AppError.conflict('A record with this value already exists');
      case 'P2025':
        return AppError.notFound('The requested record does not exist');
      default:
        return AppError.internal('Database request failed', error);
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return AppError.badRequest('Malformed database query');
  }

  // Body-parser JSON syntax failures arrive as SyntaxError with a status.
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    return AppError.badRequest('Request body is not valid JSON');
  }

  // Body-parser rejects oversized payloads with a 413. Turn it into a
  // clean, honest error rather than the opaque 500 it otherwise becomes.
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    return AppError.badRequest('Request body is too large');
  }

  return AppError.internal('Internal server error', error);
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const appError = normalizeError(error);

  const logContext = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
  };

  if (appError.isOperational) {
    logger.warn(appError.message, logContext);
  } else {
    // Programmer errors get the full original error and stack.
    logger.error(appError.message, { ...logContext, cause: error });
  }

  /*
   * An authenticated request that resolves to 403/404 on a project-scoped
   * path is a probe for someone else's data (ownership resolves as 404 by
   * design — see workspace.service). Recorded as an audit event so a
   * pattern of them is visible, without turning ordinary typos into noise:
   * only authenticated, project-scoped paths qualify.
   */
  const user = (req as { user?: { id?: string } }).user;
  if (
    user?.id &&
    (appError.statusCode === 403 || appError.statusCode === 404) &&
    req.originalUrl.includes('/projects/')
  ) {
    audit('UNAUTHORIZED_ACCESS_ATTEMPT', {
      userId: user.id,
      requestId: req.id,
      detail: { method: req.method, path: req.originalUrl, code: appError.code },
    });
  }

  const body: ApiFailure = {
    success: false,
    error: {
      code: appError.code,
      // Never leak details of non-operational failures outside development.
      message:
        appError.isOperational || !config.isProduction ? appError.message : 'Internal server error',
      ...(appError.details ? { details: appError.details } : {}),
    },
    meta: { requestId: req.id },
  };

  res.status(appError.statusCode).json(body);
};
