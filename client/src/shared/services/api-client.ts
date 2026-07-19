/**
 * HTTP layer.
 *
 * One axios instance, one error shape. Interceptors unwrap the server's
 * success envelope and normalize every failure — HTTP error, envelope
 * error, or network fault — into `ApiClientError`, so feature code never
 * touches axios internals or guesses at error formats.
 */
import axios, { AxiosError } from 'axios';

import type { ApiErrorCode, ApiFailure, ApiSuccess } from '@/shared/types/api';

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { status?: number; requestId?: string },
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = options?.status;
    this.requestId = options?.requestId;
  }
}

function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'error' in value
  );
}

export const apiClient = axios.create({
  // Same-origin by default; Vite proxies /api in dev, nginx in production.
  baseURL: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (error instanceof AxiosError) {
      const body: unknown = error.response?.data;
      if (isApiFailure(body)) {
        throw new ApiClientError(body.error.code, body.error.message, {
          ...(error.response ? { status: error.response.status } : {}),
          requestId: body.meta.requestId,
        });
      }
      throw new ApiClientError('NETWORK_ERROR', 'The API is unreachable', {
        ...(error.response ? { status: error.response.status } : {}),
      });
    }
    throw error instanceof Error ? error : new Error(String(error));
  },
);

/** Extract `data` from a success envelope, with the type asserted once here. */
export function unwrap<T>(body: ApiSuccess<T>): T {
  return body.data;
}
