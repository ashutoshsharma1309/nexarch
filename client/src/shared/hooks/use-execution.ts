/**
 * Execution data for the Activity view. The job list and usage are ordinary
 * queries; the event feed is one long-lived connection per selected job.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  fetchAllExecutionEvents,
  fetchExecutionJobs,
  fetchExecutionUsage,
} from '@/shared/services/execution.service';
import { INITIAL_FEED_STATE, startExecutionFeed } from '@/shared/services/execution-feed';
import type { ExecutionFeedState } from '@/shared/services/execution-feed';
import { openExecutionStream } from '@/shared/services/execution-stream';
import type { ExecutionJobSummary } from '@/shared/types/execution';

const JOBS_REFRESH_MS = 5_000;

export function isActiveJob(job: ExecutionJobSummary): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/**
 * `buildInFlight` keeps the list fresh before a new build has its first row,
 * which is the only time a job can exist without the list showing it.
 */
export function useExecutionJobs(projectId: string | undefined, buildInFlight: boolean) {
  return useQuery({
    queryKey: ['project', projectId, 'executions'],
    queryFn: () => {
      if (!projectId) throw new Error('A project id is required');
      return fetchExecutionJobs(projectId);
    },
    enabled: Boolean(projectId),
    staleTime: 0,
    refetchInterval: (query) =>
      buildInFlight || query.state.data?.some(isActiveJob) ? JOBS_REFRESH_MS : false,
  });
}

/** `revision` changes when a stage ends, which is when new usage can exist. */
export function useExecutionUsage(
  projectId: string | undefined,
  jobId: string | null,
  revision: number,
) {
  return useQuery({
    queryKey: ['project', projectId, 'executions', jobId, 'usage', revision],
    queryFn: () => {
      if (!projectId || !jobId) throw new Error('A job is required');
      return fetchExecutionUsage(projectId, jobId);
    },
    enabled: Boolean(projectId && jobId),
    placeholderData: keepPreviousData,
  });
}

export function useExecutionFeed(
  projectId: string | undefined,
  jobId: string | null,
): { feed: ExecutionFeedState; reconnect: () => void } {
  const [feed, setFeed] = useState<ExecutionFeedState>(INITIAL_FEED_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!projectId || !jobId) return undefined;
    return startExecutionFeed(
      {
        fetchEvents: (after) => fetchAllExecutionEvents(projectId, jobId, after),
        openStream: (afterSeq, handlers, signal) =>
          openExecutionStream({ projectId, jobId, afterSeq, signal, ...handlers }),
        isJobSettled: async () => {
          const job = (await fetchExecutionJobs(projectId)).find((row) => row.jobId === jobId);
          return job ? !isActiveJob(job) : false;
        },
      },
      setFeed,
    );
  }, [projectId, jobId, attempt]);

  return {
    feed,
    reconnect: () => {
      setAttempt((value) => value + 1);
    },
  };
}
