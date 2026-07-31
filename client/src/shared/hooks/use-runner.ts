/**
 * Runner hooks. The session query polls while the session is in an
 * active phase and goes quiet the moment it settles — phase-aware
 * refetchInterval instead of a fixed poll, so a stopped session costs
 * nothing. Logs poll on their own faster cadence with a cursor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import {
  createRunSession,
  getRunLogs,
  getRunSession,
  listRunSessions,
  restartRunSession,
  stopRunSession,
} from '@/shared/services/runner.service';
import type { CreateRunSessionRequest, RunLogLine, RunPhase } from '@/shared/types/api';

const ACTIVE_PHASES: RunPhase[] = ['preparing', 'installing', 'starting', 'restarting'];

export function useRunSessions() {
  return useQuery({ queryKey: ['runner', 'sessions'], queryFn: listRunSessions });
}

export function useRunSession(id: string | null) {
  return useQuery({
    queryKey: ['runner', 'session', id],
    queryFn: () => {
      if (!id) throw new Error('No session selected');
      return getRunSession(id);
    },
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      if (!phase) return 1_000;
      if (ACTIVE_PHASES.includes(phase)) return 1_000; // startup moves fast
      if (phase === 'running') return 5_000; // just watching for crashes
      return false; // stopped/failed — nothing will change
    },
  });
}

/** Accumulates log lines client-side; the server only ever sends what's new. */
export function useRunLogs(id: string | null, active: boolean) {
  const linesRef = useRef<RunLogLine[]>([]);
  const cursorRef = useRef(0);
  const sessionRef = useRef(id);

  if (sessionRef.current !== id) {
    // Switching sessions resets the accumulator.
    sessionRef.current = id;
    linesRef.current = [];
    cursorRef.current = 0;
  }

  const query = useQuery({
    queryKey: ['runner', 'logs', id],
    queryFn: async () => {
      if (!id) throw new Error('No session selected');
      const chunk = await getRunLogs(id, cursorRef.current);
      if (chunk.lines.length > 0) {
        linesRef.current = [...linesRef.current, ...chunk.lines].slice(-2_000);
        cursorRef.current = chunk.nextCursor;
      }
      return linesRef.current;
    },
    enabled: Boolean(id),
    refetchInterval: active ? 1_000 : false,
  });

  return { ...query, lines: query.data ?? linesRef.current };
}

export function useCreateRunSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateRunSessionRequest) => createRunSession(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runner', 'sessions'] });
    },
  });
}

export function useStopRunSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stopRunSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runner'] });
    },
  });
}

export function useRestartRunSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restartRunSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runner'] });
    },
  });
}
