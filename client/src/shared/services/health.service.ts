import type { ApiSuccess, HealthReport } from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

/**
 * Fetch the API health report.
 *
 * A degraded server answers 503 *with a valid success envelope* — that is
 * data, not an error, so this request accepts 503 explicitly instead of
 * letting the interceptor convert it into a thrown failure.
 */
export async function fetchHealth(): Promise<HealthReport> {
  const response = await apiClient.get<ApiSuccess<HealthReport>>('/health', {
    validateStatus: (status) => status === 200 || status === 503,
  });
  return unwrap(response.data);
}
