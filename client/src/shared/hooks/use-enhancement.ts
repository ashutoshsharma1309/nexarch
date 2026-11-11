/**
 * Data access for enhancing a project.
 *
 * Progress is read from two durable sources: the job row says where the work
 * is, and the event log says what really happened. Both are polled rather
 * than streamed here, because a reload or a dropped connection then needs no
 * reconnect logic: the next read simply carries on from the last event held.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { isTerminalEditJob } from '@/shared/hooks/use-project-edits';
import {
  applyEnhancement,
  cancelEnhancement,
  EVENT_PAGE_LIMIT,
  fetchCurrentEnhancementJob,
  fetchEnhancementEvents,
  fetchEnhancementJob,
  planEnhancement,
  revertEnhancement,
} from '@/shared/services/enhancement.service';
import type {
  EnhancementJob,
  EnhancementPlan,
  PlanEnhancementPayload,
} from '@/shared/services/enhancement.service';
import type { ExecutionEvent } from '@/shared/types/execution';

function jobKey(projectId: string | undefined, jobId: string | null) {
  return ['enhancement-job', projectId, jobId];
}

function planKey(projectId: string | undefined) {
  return ['enhancement-plan', projectId];
}

function eventsKey(projectId: string | undefined, jobId: string | null) {
  return ['enhancement-events', projectId, jobId];
}

export function isEnhancementRunning(job: EnhancementJob | null | undefined): boolean {
  return job !== null && job !== undefined && !isTerminalEditJob(job.status);
}

/**
 * The plan waiting for a decision.
 *
 * There is no route to read a plan back, so the cache is what carries it
 * across a switch to another workspace tab. Discarding clears it.
 */
export function useHeldEnhancementPlan(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery<EnhancementPlan | null>({
    queryKey: planKey(projectId),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const clear = useCallback(() => {
    queryClient.setQueryData(planKey(projectId), null);
  }, [projectId, queryClient]);
  return { plan: query.data ?? null, clear };
}

export function usePlanEnhancement(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (payload: PlanEnhancementPayload) => {
      if (!projectId) throw new Error('No project');
      return planEnhancement(projectId, payload);
    },
    onSuccess: (plan) => {
      queryClient.setQueryData(planKey(projectId), plan);
    },
  });
}

export function useApplyEnhancement(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (planId: string) => {
      if (!projectId) throw new Error('No project');
      return applyEnhancement(projectId, planId);
    },
    onSuccess: (job) => {
      queryClient.setQueryData(jobKey(projectId, job.id), job);
      queryClient.setQueryData(planKey(projectId), null);
      void queryClient.invalidateQueries({ queryKey: jobKey(projectId, 'current') });
    },
  });
}

function pollInterval(elapsedMs: number): number {
  if (elapsedMs < 15_000) return 1_500;
  if (elapsedMs < 60_000) return 3_000;
  return 5_000;
}

/** One enhancement job, polled until it is over. */
export function useEnhancementJob(projectId: string | undefined, jobId: string | null) {
  return useQuery({
    queryKey: jobKey(projectId, jobId),
    queryFn: () => {
      if (!projectId || !jobId) throw new Error('No enhancement job selected');
      return fetchEnhancementJob(projectId, jobId);
    },
    enabled: Boolean(projectId) && Boolean(jobId),
    retry: false,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return query.state.status === 'error' ? false : 2_000;
      if (isTerminalEditJob(job.status)) return false;
      return pollInterval(Date.now() - new Date(job.startedAt ?? job.createdAt).getTime());
    },
    refetchIntervalInBackground: true,
  });
}

/** Asked on load, so a reload shows the work already running. */
export function useCurrentEnhancementJob(projectId: string | undefined) {
  return useQuery({
    queryKey: jobKey(projectId, 'current'),
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchCurrentEnhancementJob(projectId);
    },
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 10_000,
  });
}

export function useCancelEnhancement(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (jobId: string) => {
      if (!projectId) throw new Error('No project');
      return cancelEnhancement(projectId, jobId);
    },
    onSuccess: (job) => {
      queryClient.setQueryData(jobKey(projectId, job.id), job);
    },
    // Most often a 409: it finished while the button was being pressed. Either
    // way the row is the truth, so read it now instead of at the next poll.
    onError: (_error, jobId) => {
      void queryClient.invalidateQueries({ queryKey: jobKey(projectId, jobId) });
    },
  });
}

export function useRevertEnhancement(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (jobId: string) => {
      if (!projectId) throw new Error('No project');
      return revertEnhancement(projectId, jobId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'runs'] });
      void queryClient.invalidateQueries({ queryKey: ['graph', projectId] });
      void queryClient.invalidateQueries({ queryKey: jobKey(projectId, 'current') });
    },
  });
}

/**
 * Refresh what a finished enhancement changed.
 *
 * An applied one becomes the project's newest run, so its history, files and
 * graph have all moved. The apply mutation cannot do this: when it returns,
 * the work has only just started.
 */
export function useRefreshOnSettledEnhancement(
  projectId: string | undefined,
  job: EnhancementJob | null,
): void {
  const queryClient = useQueryClient();
  const settledJobId = job !== null && isTerminalEditJob(job.status) ? job.id : null;
  const appliedRunId = job?.status === 'SUCCEEDED' ? job.runId : null;

  useEffect(() => {
    if (projectId === undefined || settledJobId === null) return;
    void queryClient.invalidateQueries({ queryKey: jobKey(projectId, 'current') });
  }, [projectId, queryClient, settledJobId]);

  useEffect(() => {
    if (projectId === undefined || appliedRunId === null) return;
    void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'runs'] });
    void queryClient.invalidateQueries({ queryKey: ['graph', projectId] });
  }, [appliedRunId, projectId, queryClient]);
}

/** Adds a new page to the events held, in order, without repeating any. */
export function mergeEnhancementEvents(
  held: readonly ExecutionEvent[],
  page: readonly ExecutionEvent[],
): ExecutionEvent[] {
  const bySeq = new Map<number, ExecutionEvent>();
  for (const event of held) bySeq.set(event.seq, event);
  for (const event of page) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Enough to read any real job's log, without trusting an endless reply. */
const MAX_EVENT_PAGES = 20;

/**
 * The events this job has really recorded, gathered as they appear.
 *
 * Each read asks only for what came after the last event held, and one more
 * read happens when the job settles, because the terminal events land at the
 * same moment the row does and the poll that saw the row can miss them.
 */
export function useEnhancementEvents(
  projectId: string | undefined,
  jobId: string | null,
  settled: boolean,
) {
  const queryClient = useQueryClient();
  const query = useQuery<ExecutionEvent[]>({
    queryKey: eventsKey(projectId, jobId),
    queryFn: async () => {
      if (!projectId || !jobId) throw new Error('No enhancement job selected');
      let events = queryClient.getQueryData<ExecutionEvent[]>(eventsKey(projectId, jobId)) ?? [];
      for (let pages = 0; pages < MAX_EVENT_PAGES; pages += 1) {
        const page = await fetchEnhancementEvents(projectId, jobId, events.at(-1)?.seq ?? 0);
        events = mergeEnhancementEvents(events, page);
        if (page.length < EVENT_PAGE_LIMIT) break;
      }
      return events;
    },
    enabled: Boolean(projectId) && Boolean(jobId),
    retry: false,
    refetchInterval: settled ? false : 2_500,
    refetchIntervalInBackground: true,
  });

  const { refetch } = query;
  useEffect(() => {
    if (settled) void refetch({ cancelRefetch: false });
  }, [refetch, settled]);

  return query;
}
