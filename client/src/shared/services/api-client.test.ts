/**
 * HTTP-layer tests. The api-client's whole contract is "features never
 * touch axios internals or guess at error formats" — so these tests pin
 * exactly that seam: success envelopes unwrap, failure envelopes become
 * typed ApiClientErrors carrying code + requestId, and transport faults
 * normalize to NETWORK_ERROR. A fake axios adapter stands in for the
 * wire; every interceptor in the real client still runs.
 */
import { AxiosError } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiSuccess } from '@/shared/types/api';
import { ApiClientError, apiClient, setUnauthorizedHandler, unwrap } from './api-client';

const originalAdapter = apiClient.defaults.adapter;

type Adapter = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

function useAdapter(handler: Adapter): void {
  apiClient.defaults.adapter = handler as never;
}

function respondWith(status: number, data: unknown): Adapter {
  return (config) => {
    const response: AxiosResponse = { data, status, statusText: 'OK', headers: {}, config };
    if (status < 400) return Promise.resolve(response);
    return Promise.reject(
      new AxiosError(
        `Request failed with status code ${String(status)}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        response,
      ),
    );
  };
}

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  // The handler is module state, so a test that registers one would
  // otherwise keep counting another test's 401s.
  setUnauthorizedHandler(() => undefined);
});

function unauthorized(message: string): unknown {
  return {
    success: false,
    error: { code: 'UNAUTHORIZED', message },
    meta: { requestId: 'req-401' },
  };
}

function ok(data: unknown): unknown {
  return { success: true, data, meta: { requestId: 'req-ok' } };
}

/**
 * An adapter that answers per URL and records the order it was asked in.
 *
 * The order is the point of most of these tests: "refreshed once, then
 * replayed once" and "looped forever" produce the same final error, and the
 * only thing that tells them apart is the sequence of requests.
 */
function recording(handler: (url: string, seen: string[]) => Adapter): {
  seen: string[];
  adapter: Adapter;
} {
  const seen: string[] = [];
  return {
    seen,
    adapter: (config) => {
      const url = config.url ?? '';
      seen.push(url);
      return handler(url, seen)(config);
    },
  };
}

describe('api-client', () => {
  it('unwraps a success envelope to its data', async () => {
    useAdapter(
      respondWith(200, { success: true, data: { status: 'ok' }, meta: { requestId: 'req-1' } }),
    );

    const response = await apiClient.get<ApiSuccess<{ status: string }>>('/health/live');
    expect(unwrap(response.data)).toEqual({ status: 'ok' });
  });

  it('normalizes a failure envelope into ApiClientError with code, status and requestId', async () => {
    useAdapter(
      respondWith(422, {
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'Request validation failed' },
        meta: { requestId: 'req-2' },
      }),
    );

    const failure = await apiClient.post('/analyze', {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    const typed = failure as ApiClientError;
    expect(typed.code).toBe('VALIDATION_FAILED');
    expect(typed.status).toBe(422);
    expect(typed.requestId).toBe('req-2');
    expect(typed.message).toBe('Request validation failed');
  });

  it('normalizes transport faults (no response at all) into NETWORK_ERROR', async () => {
    useAdapter((config) =>
      Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)),
    );

    const failure = await apiClient.get('/health').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).code).toBe('NETWORK_ERROR');
    expect((failure as ApiClientError).message).toBe('The API is unreachable');
  });
});

/**
 * The refresh-and-replay half of the interceptor, which was untested.
 *
 * Access tokens expire in minutes and generation runs for longer than that,
 * so this path runs constantly in normal use — and every way it can go wrong
 * is a session that dies for no reason the user can see, or a request storm
 * nobody notices until the server log is read. What matters is that the
 * replay happens exactly once, that one refusal is one refresh, and that the
 * endpoints answering with 401 as their actual answer are left alone.
 */
describe('api-client 401 handling', () => {
  it('refreshes the session and replays the request that was refused', async () => {
    const { seen, adapter } = recording((url, calls) => {
      if (url === '/auth/refresh') return respondWith(200, ok(null));
      // Only the first attempt is refused; the replay carries a fresh cookie.
      if (calls.filter((entry) => entry === '/projects').length === 1) {
        return respondWith(401, unauthorized('Access token expired'));
      }
      return respondWith(200, ok([{ id: 'project-1' }]));
    });
    useAdapter(adapter);

    const response = await apiClient.get<ApiSuccess<{ id: string }[]>>('/projects');

    // The caller never learns any of this happened — which is the feature.
    expect(unwrap(response.data)).toEqual([{ id: 'project-1' }]);
    expect(seen).toEqual(['/projects', '/auth/refresh', '/projects']);
  });

  it('ends the session once when the refresh is refused as well', async () => {
    let ended = 0;
    setUnauthorizedHandler(() => {
      ended += 1;
    });
    const { seen, adapter } = recording(() => respondWith(401, unauthorized('Session expired')));
    useAdapter(adapter);

    const failure = await apiClient.get('/projects').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).code).toBe('UNAUTHORIZED');
    expect((failure as ApiClientError).status).toBe(401);
    // The refresh cookie is gone too, so the sign-out is the honest answer —
    // and the caller still gets a typed error rather than a bare axios one.
    expect(ended).toBe(1);
    expect(seen).toEqual(['/projects', '/auth/refresh']);
  });

  it('replays a refused request once and then gives up', async () => {
    const { seen, adapter } = recording((url) =>
      url === '/auth/refresh'
        ? respondWith(200, ok(null))
        : respondWith(401, unauthorized('Not your project')),
    );
    useAdapter(adapter);

    const failure = await apiClient.get('/projects').catch((error: unknown) => error);

    // A refresh that works on a request that is refused anyway is the shape
    // of an infinite loop: refresh, replay, 401, refresh… The replay flag on
    // the config is what stops it, and this is the test that it is set.
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(seen).toEqual(['/projects', '/auth/refresh', '/projects']);
  });

  it('does not try to refresh on behalf of the auth endpoints themselves', async () => {
    let ended = 0;
    setUnauthorizedHandler(() => {
      ended += 1;
    });
    const { seen, adapter } = recording(() =>
      respondWith(401, unauthorized('Invalid credentials')),
    );
    useAdapter(adapter);

    const failure = await apiClient.post('/auth/refresh').catch((error: unknown) => error);

    // Refreshing a failed refresh is unbounded recursion. And the same guard
    // covers sign-in: a wrong password is a 401 whose answer is "wrong
    // password", not "your session ended" — so no global sign-out fires.
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(seen).toEqual(['/auth/refresh']);
    expect(ended).toBe(0);
  });

  it('refreshes once for a burst of requests that all expire together', async () => {
    const refused = new Set<string>();
    const { seen, adapter } = recording((url) => {
      if (url === '/auth/refresh') return respondWith(200, ok(null));
      if (!refused.has(url)) {
        refused.add(url);
        return respondWith(401, unauthorized('Access token expired'));
      }
      return respondWith(200, ok({ url }));
    });
    useAdapter(adapter);

    const [runs, graph] = await Promise.all([
      apiClient.get<ApiSuccess<{ url: string }>>('/project/p1/runs'),
      apiClient.get<ApiSuccess<{ url: string }>>('/graph/p1'),
    ]);

    expect(unwrap(runs.data).url).toBe('/project/p1/runs');
    expect(unwrap(graph.data).url).toBe('/graph/p1');
    // One rotation of the refresh cookie, not one per query in flight —
    // concurrent refreshes race and invalidate each other's new cookie.
    expect(seen.filter((entry) => entry === '/auth/refresh')).toHaveLength(1);
  });
});
