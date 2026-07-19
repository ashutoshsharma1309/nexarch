import { QueryClient } from '@tanstack/react-query';

import { ApiClientError } from './api-client';

/**
 * Query cache policy for the whole app. Individual queries override only
 * when they have a reason (the health poll sets its own interval).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 4xx responses are contract errors — retrying cannot fix them.
        if (error instanceof ApiClientError && error.status !== undefined && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});
