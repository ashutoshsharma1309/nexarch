import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchEngineeringReview,
  fetchProjectIntelligence,
  fetchFindings,
  fetchRepairs,
  fetchValidation,
  startRepairs,
  updateFindingStatus,
} from '@/shared/services/review.service';
import type { FindingStatus } from '@/shared/types/api';

/**
 * The latest engineering review, or a specific past version.
 *
 * A 404 here is not an error state worth retrying — it means no review has
 * run yet, and the section renders that as an invitation rather than a
 * failure.
 */
export function useEngineeringReview(projectId: string | undefined, version?: number) {
  return useQuery({
    queryKey: ['engineering-review', projectId, version ?? 'latest'],
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchEngineeringReview(projectId, version);
    },
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The live finding records.
 *
 * Separate from the review artifact on purpose: the artifact is a
 * versioned snapshot and stays as written, while these reflect status
 * changes the moment a person makes them.
 */
export function useProjectFindings(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-findings', projectId],
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchFindings(projectId);
    },
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
}

/** A person's decision about a finding. Refreshes the live records. */
export function useUpdateFindingStatus(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, status }: { findingId: string; status: FindingStatus }) => {
      if (!projectId) throw new Error('No project');
      return updateFindingStatus(projectId, findingId, status);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-findings', projectId] });
    },
  });
}

/** The latest validation run: summary, runtime, integration, tests. */
export function useValidation(projectId: string | undefined) {
  return useQuery({
    queryKey: ['validation', projectId],
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchValidation(projectId);
    },
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
}

/** The repair session and history. Polls while a session is running. */
export function useRepairs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['repairs', projectId],
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchRepairs(projectId);
    },
    enabled: Boolean(projectId),
    retry: false,
    refetchInterval: (query) => (query.state.data?.session?.status === 'RUNNING' ? 1500 : false),
  });
}

export function useStartRepairs(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('No project');
      return startRepairs(projectId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repairs', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-findings', projectId] });
    },
  });
}

const ACTIVE_STATUSES = ['BUILDING', 'REVIEWING', 'VALIDATING', 'REPAIRING'];

/**
 * The whole dashboard in one query (Step 22). Polls only while something
 * is actually running — a settled project costs one request per visit.
 */
export function useProjectIntelligence(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-intelligence', projectId],
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchProjectIntelligence(projectId);
    },
    enabled: Boolean(projectId),
    retry: 1,
    staleTime: 15_000,
    refetchInterval: (query) =>
      ACTIVE_STATUSES.includes(query.state.data?.status ?? '') ? 2_500 : false,
  });
}
