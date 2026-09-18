/**
 * Builder Agent hooks. A running session is polled every two seconds — the
 * steps it records are minutes long, so faster would only spend the API's
 * budget — and polling stops the moment the session settles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelBuilderSession,
  fetchBuilderSession,
  fetchBuilderSessions,
  startBuilderSession,
} from '@/shared/services/builder.service';

const POLL_MS = 2_000;

export function useBuilderSessions() {
  return useQuery({
    queryKey: ['builder', 'sessions'],
    queryFn: fetchBuilderSessions,
    refetchInterval: (query) =>
      query.state.data?.some((session) => session.status === 'running') ? POLL_MS * 3 : false,
  });
}

export function useBuilderSession(id: string | null) {
  return useQuery({
    queryKey: ['builder', 'session', id],
    queryFn: () => {
      if (!id) throw new Error('No session selected');
      return fetchBuilderSession(id);
    },
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_MS : false),
  });
}

export function useStartBuilder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: string) => startBuilderSession(task),
    onSuccess: (session) => {
      queryClient.setQueryData(['builder', 'session', session.id], session);
      void queryClient.invalidateQueries({ queryKey: ['builder', 'sessions'] });
    },
  });
}

export function useCancelBuilder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelBuilderSession(id),
    onSuccess: (session) => {
      queryClient.setQueryData(['builder', 'session', session.id], session);
    },
  });
}
