/**
 * Data access for project edits.
 *
 * A plan is immutable until it is applied, and this client is the only thing
 * that applies it — so the plan query never polls and never goes stale on a
 * timer. Applying is a mutation with no retry: the call runs for minutes and
 * installs packages on the way, so a silent second attempt is the last thing
 * anyone wants.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { applyEdit, fetchEditPlan, planEdit } from '@/shared/services/project-editor.service';
import type { PlanEditPayload } from '@/shared/services/project-editor.service';

function editPlanKey(projectId: string | undefined, planId: string | null) {
  return ['project-edit-plan', projectId, planId];
}

/** One edit plan. Enabled only once there is a plan to read. */
export function useEditPlan(projectId: string | undefined, planId: string | null) {
  return useQuery({
    queryKey: editPlanKey(projectId, planId),
    queryFn: () => {
      if (!projectId || !planId) throw new Error('No edit plan selected');
      return fetchEditPlan(projectId, planId);
    },
    enabled: Boolean(projectId) && Boolean(planId),
    retry: false,
    staleTime: Infinity,
  });
}

export function usePlanEdit(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlanEditPayload) => {
      if (!projectId) throw new Error('No project');
      return planEdit(projectId, payload);
    },
    onSuccess: (plan) => {
      // The plan came back whole; seeding its entry saves the review from
      // fetching what this call already has.
      queryClient.setQueryData(editPlanKey(projectId, plan.id), plan);
    },
  });
}

export function useApplyEdit(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (planId: string) => {
      if (!projectId) throw new Error('No project');
      return applyEdit(projectId, planId);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: editPlanKey(projectId, result.planId),
      });
      // An accepted edit is recorded as the project's newest run, so the
      // history and every view that reads "the latest run" have moved. A
      // discarded one changed nothing, and invalidating would be noise.
      if (result.runId !== null) {
        void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'runs'] });
      }
    },
  });
}
