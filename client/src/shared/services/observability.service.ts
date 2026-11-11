/**
 * Reading execution timelines.
 *
 * Two calls, for the same reason the pipeline's run and artifacts are two:
 * the listing is a handful of summaries and the timeline itself is every
 * event, and the caller that lists is about to ask for exactly one of them.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess } from '@/shared/types/api';
import type { Timeline, TimelineList } from '@/shared/types/timeline';

/**
 * Recent executions, optionally narrowed to one project.
 *
 * The narrowing is the server's job, not a filter the caller can apply: an
 * edit job and a preview session are keyed by their own ids, so a client
 * holding a list of run ids cannot tell which timelines belong to the
 * project it is showing. Filtering here by run id reported a real edit's
 * timeline as "no timeline is held".
 */
export async function fetchTimelines(projectId?: string): Promise<TimelineList> {
  const { data } = await apiClient.get<ApiSuccess<TimelineList>>('/observability/timelines', {
    ...(projectId === undefined ? {} : { params: { projectId } }),
  });
  return unwrap(data);
}

export async function fetchTimeline(key: string): Promise<Timeline> {
  const { data } = await apiClient.get<ApiSuccess<Timeline>>(`/observability/timelines/${key}`);
  return unwrap(data);
}
