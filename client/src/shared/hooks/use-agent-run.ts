import { useMutation, useQuery } from '@tanstack/react-query';

import {
  cancelAgentRun,
  fetchAgentCatalogue,
  fetchAgentRun,
  resumeAgentRun,
  startAgentRun,
} from '@/shared/services/agent.service';

const POLL_MS = 1000;

/** Polls only while the run is live — a settled run is terminal server-side. */
export function useAgentRun(projectId: string | undefined, runId: string | null) {
  return useQuery({
    queryKey: ['agent-run', projectId, runId],
    queryFn: () => {
      if (!projectId || !runId) throw new Error('No agent run selected');
      return fetchAgentRun(projectId, runId);
    },
    enabled: Boolean(projectId && runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'RUNNING' || status === 'PENDING' ? POLL_MS : false;
    },
  });
}

export function useAgentCatalogue(projectId: string | undefined) {
  return useQuery({
    queryKey: ['agent-catalogue', projectId],
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchAgentCatalogue(projectId);
    },
    enabled: Boolean(projectId),
    staleTime: 5 * 60_000,
  });
}

export function useStartAgentRun(projectId: string | undefined) {
  return useMutation({
    mutationFn: (prompt: string) => {
      if (!projectId) throw new Error('No project');
      return startAgentRun(projectId, prompt);
    },
  });
}

export function useCancelAgentRun(projectId: string | undefined) {
  return useMutation({
    mutationFn: (runId: string) => {
      if (!projectId) throw new Error('No project');
      return cancelAgentRun(projectId, runId);
    },
  });
}

export function useResumeAgentRun(projectId: string | undefined) {
  return useMutation({
    mutationFn: (runId: string) => {
      if (!projectId) throw new Error('No project');
      return resumeAgentRun(projectId, runId);
    },
  });
}
