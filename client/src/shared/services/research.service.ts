/** The research a build really gathered, scoped to the project in the URL. */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess } from '@/shared/types/api';
import type { RunResearchResponse } from '@/shared/types/research';

export async function fetchRunResearch(
  projectId: string,
  runId: string,
): Promise<RunResearchResponse> {
  const { data } = await apiClient.get<ApiSuccess<RunResearchResponse>>(
    `/projects/${projectId}/runs/${runId}/research`,
  );
  return unwrap(data);
}
