import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  generate,
  getHistory,
  getStatistics,
  retryGeneration,
  runWorkflow,
} from '@/shared/services/ai-orchestrator.service';
import type {
  GenerateOptions,
  WorkflowStepPayload,
} from '@/shared/services/ai-orchestrator.service';

const HISTORY_KEY = ['ai', 'history'];
const STATS_KEY = ['ai', 'statistics'];

/** The AI Operations dashboard is self-contained — unlike every other Explorer, it doesn't chain off the design pipeline; it shows the orchestrator's own operational state. */
export function useGenerationHistory(limit = 25) {
  return useQuery({
    queryKey: [...HISTORY_KEY, limit],
    queryFn: () => getHistory(limit),
    refetchInterval: 15_000,
  });
}

export function useAiStatistics() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: () => getStatistics(),
    refetchInterval: 15_000,
  });
}

export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: GenerateOptions) => generate(options),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: STATS_KEY });
    },
  });
}

export function useRetryGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: GenerateOptions) => retryGeneration(options),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: STATS_KEY });
    },
  });
}

export function useRunWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, steps }: { workflowId: string; steps: WorkflowStepPayload[] }) =>
      runWorkflow(workflowId, steps),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: STATS_KEY });
    },
  });
}
