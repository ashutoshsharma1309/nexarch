import { useQuery } from '@tanstack/react-query';

import { fetchHealth } from '@/shared/services/health.service';

/** Poll API health for the status indicator in the top bar. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    // The indicator should degrade gracefully, not retry-storm a dead API.
    retry: false,
  });
}
