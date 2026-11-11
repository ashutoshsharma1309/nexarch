/**
 * Execution history over plain HTTP. The stream lives in `execution-stream.ts`;
 * these are what restores a timeline after a refresh and what polling falls
 * back to when the stream cannot be held open.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess } from '@/shared/types/api';
import type {
  ExecutionEvent,
  ExecutionJobSummary,
  StageUsageRecord,
} from '@/shared/types/execution';

/** The server's page size: a shorter page is the last one. */
export const EXECUTION_EVENTS_PAGE = 500;

export async function fetchExecutionJobs(projectId: string): Promise<ExecutionJobSummary[]> {
  const { data } = await apiClient.get<ApiSuccess<ExecutionJobSummary[]>>(
    `/projects/${projectId}/executions`,
  );
  return unwrap(data);
}

export async function fetchExecutionEvents(
  projectId: string,
  jobId: string,
  after = 0,
): Promise<ExecutionEvent[]> {
  const { data } = await apiClient.get<ApiSuccess<ExecutionEvent[]>>(
    `/projects/${projectId}/executions/${jobId}/events`,
    { params: { after } },
  );
  return unwrap(data);
}

/** Every event after `after`, across as many pages as that takes. */
export async function fetchAllExecutionEvents(
  projectId: string,
  jobId: string,
  after = 0,
): Promise<ExecutionEvent[]> {
  const collected: ExecutionEvent[] = [];
  let cursor = after;
  for (;;) {
    const page = await fetchExecutionEvents(projectId, jobId, cursor);
    collected.push(...page);
    const last = page.at(-1);
    // A full page whose cursor did not move would otherwise loop forever.
    if (page.length < EXECUTION_EVENTS_PAGE || !last || last.seq <= cursor) return collected;
    cursor = last.seq;
  }
}

export async function fetchExecutionUsage(
  projectId: string,
  jobId: string,
): Promise<StageUsageRecord[]> {
  const { data } = await apiClient.get<ApiSuccess<StageUsageRecord[]>>(
    `/projects/${projectId}/executions/${jobId}/usage`,
  );
  return unwrap(data);
}
