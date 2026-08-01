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
import { ApiClientError, apiClient, unwrap } from './api-client';

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
});

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
