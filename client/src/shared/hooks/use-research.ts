import { useQuery } from '@tanstack/react-query';

import { fetchRunResearch } from '@/shared/services/research.service';

/** Fetched once per run: a completed run's research never changes. */
export function useRunResearch(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId, 'runs', runId, 'research'],
    queryFn: () => {
      if (!projectId || !runId) throw new Error('A completed build is required');
      return fetchRunResearch(projectId, runId);
    },
    enabled: Boolean(projectId && runId),
    staleTime: Infinity,
  });
}
