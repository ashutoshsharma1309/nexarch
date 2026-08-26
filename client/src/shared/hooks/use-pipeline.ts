/**
 * Pipeline data access.
 *
 * Polling stops the moment the run stops — a completed or failed run is
 * terminal server-side, so continuing to ask would be pure noise on the
 * network tab and in the server log.
 */
import { useMutation, useQuery } from '@tanstack/react-query';

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

export function useStartRun() {
  return useMutation({ mutationFn: startRun });
}

export function useRetryRun() {
  return useMutation({ mutationFn: retryRun });
}
