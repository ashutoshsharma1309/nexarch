/**
 * Pipeline data access.
 *
 * Polling stops the moment the run stops — a completed or failed run is
 * terminal server-side, so continuing to ask would be pure noise on the
 * network tab and in the server log.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchArtifacts,
  fetchRun,
  fetchRuns,
  retryRun,
  startRun,
} from '@/shared/services/pipeline.service';
import type { PipelineRun } from '@/shared/types/api';

const POLL_INTERVAL_MS = 1000;

export function usePipelineRun(id: string | null) {
  return useQuery({
    queryKey: ['pipeline', 'run', id],
    queryFn: () => {
      if (!id) throw new Error('No run selected');
      return fetchRun(id);
    },
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const run = query.state.data;
      return run && run.status !== 'running' ? false : POLL_INTERVAL_MS;
    },
  });
}

export function usePipelineRuns() {
  return useQuery({ queryKey: ['pipeline', 'runs'], queryFn: fetchRuns, staleTime: 10_000 });
}

/** The artifact bundle for a finished run. Fetched once and cached forever — a run is immutable. */
export function usePipelineArtifacts(run: PipelineRun | undefined) {
  const ready = run?.status === 'completed';
  return useQuery({
    queryKey: ['pipeline', 'artifacts', run?.id],
    queryFn: () => {
      if (!run) throw new Error('No run selected');
      return fetchArtifacts(run.id);
    },
    enabled: ready,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Start a run, and make sure the project hears about it either way.
 *
 * The invalidation lives here rather than in the component's `mutate`
 * callback on purpose. Those callbacks are dropped if the component
 * unmounts before the request resolves, and this request resolves in about
 * 150ms — long enough to lose the race to a re-render that replaces the
 * subtree. When that happened, the server accepted the run and built the
 * project to completion while the console still read "Never built", with no
 * way back to the run but a reload. A hook-level callback always fires, so
 * the project's run list refreshes, the workspace sees a run in flight, and
 * the build the user asked for is on screen whichever component is mounted.
 */
export function useStartRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startRun,
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['project', run.projectId, 'runs'] });
    },
  });
}

export function useRetryRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryRun,
    // Same reasoning as `useStartRun`: a retry is a new run, and losing the
    // news of it is how a running build becomes invisible.
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['project', run.projectId, 'runs'] });
    },
  });
}
