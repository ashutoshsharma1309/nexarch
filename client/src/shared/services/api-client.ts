/**
 * HTTP layer.
 *
 * One axios instance, one error shape. Interceptors unwrap the server's
 * success envelope and normalize every failure — HTTP error, envelope
 * error, or network fault — into `ApiClientError`, so feature code never
 * touches axios internals or guesses at error formats.
 */
import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

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

/**
 * Called once whenever the API says the session is gone. Registered in
 * `main.tsx` rather than imported here, because the auth store imports the
 * auth service which imports this module — a direct import would close that
 * loop.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
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
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  // The session lives in httpOnly cookies; without this axios drops them.
  withCredentials: true,
});

/**
 * Access tokens are short-lived by design; the refresh cookie is what makes
 * that survivable. Without this, a session silently dies fifteen minutes in
 * — mid-generation, mid-preview — and the user is bounced to the login page
 * with no explanation.
 *
 * One refresh at a time: concurrent 401s from a burst of queries all await
 * the same in-flight refresh instead of firing one each and rotating the
 * cookie out from under one another.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= apiClient
    .post('/auth/refresh')
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Endpoints where a 401 is the answer, not a stale token — retrying them would loop. */
function isAuthEndpoint(url: string | undefined): boolean {
  return url?.includes('/auth/') ?? false;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  /** Set once a request has already been replayed after a refresh. */
  retriedAfterRefresh?: boolean;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (error instanceof AxiosError) {
      const config = error.config as RetriableConfig | undefined;

      if (
        error.response?.status === 401 &&
        config &&
        !config.retriedAfterRefresh &&
        !isAuthEndpoint(config.url)
      ) {
        if (await refreshSession()) {
          config.retriedAfterRefresh = true;
          return apiClient.request(config);
        }
        // The refresh cookie is gone too — this session is genuinely over.
        onUnauthorized?.();
      }

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
