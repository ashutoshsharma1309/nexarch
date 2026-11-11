/**
 * Execution timeline queries.
 *
 * Not polled. A timeline is a diagnostic someone opens after the fact, so
 * refetching it on an interval would spend the API budget on a screen whose
 * subject has already finished. The one case that does move — a run still
 * going — is covered by the stale time, which is short enough that
 * re-opening the section shows new events.
 */
import { useQuery } from '@tanstack/react-query';

import { fetchTimeline, fetchTimelines } from '@/shared/services/observability.service';

export function useTimelines(projectId?: string) {
  return useQuery({
    queryKey: ['timelines', projectId ?? null],
    queryFn: () => fetchTimelines(projectId),
    staleTime: 5_000,
  });
}

export function useTimeline(key: string | null) {
  return useQuery({
    queryKey: ['timeline', key],
    queryFn: () => {
      if (key === null) throw new Error('No timeline selected');
      return fetchTimeline(key);
    },
    enabled: key !== null,
    staleTime: 5_000,
  });
}
