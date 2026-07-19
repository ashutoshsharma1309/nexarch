/**
 * The application's single throwable error type.
 *
 * Anything a request pipeline intends to surface to a client is an AppError;
 * everything else is a programmer error and gets normalized to a 500 by the
 * error handler without leaking internals. `isOperational` marks errors that
 * are expected business outcomes (404, validation) versus genuine faults —
 * the error handler logs them at different severities.
 */
import type { ApiErrorCode, ApiErrorDetail } from '../types/api.js';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly isOperational: boolean;
  readonly details: ApiErrorDetail[] | undefined;

  private constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    options?: {
      details?: ApiErrorDetail[] | undefined;
      isOperational?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    this.details = options?.details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: ApiErrorDetail[]): AppError {
    return new AppError(400, 'BAD_REQUEST', message, { details });
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Insufficient permissions'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: ApiErrorDetail[]): AppError {
    return new AppError(409, 'CONFLICT', message, { details });
  }

  static validationFailed(message: string, details: ApiErrorDetail[]): AppError {
    return new AppError(422, 'VALIDATION_FAILED', message, { details });
  }

  static rateLimited(message = 'Too many requests, retry later'): AppError {
    return new AppError(429, 'RATE_LIMITED', message);
  }

  static notImplemented(message: string): AppError {
    return new AppError(501, 'NOT_IMPLEMENTED', message);
  }

  static internal(message = 'Internal server error', cause?: unknown): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message, { isOperational: false, cause });
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}
