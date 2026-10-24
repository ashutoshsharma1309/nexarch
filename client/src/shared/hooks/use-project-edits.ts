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
import { useEffect } from 'react';

import {
  applyEdit,
  fetchCurrentEditJob,
  fetchEditJob,
  fetchEditPlan,
  planEdit,
} from '@/shared/services/project-editor.service';
import type { PlanEditPayload } from '@/shared/services/project-editor.service';
import type { EditJob, EditJobStatus } from '@/shared/types/api';

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
    onSuccess: (job) => {
      // The work has only just started; what the project's history looks like
      // is not known yet, so nothing is invalidated here. The job query does
      // that when it reaches a terminal state.
      queryClient.setQueryData(editJobKey(projectId, job.id), job);
      void queryClient.invalidateQueries({ queryKey: editJobKey(projectId, 'current') });
    },
  });
}

function editJobKey(projectId: string | undefined, jobId: string | null) {
  return ['project-edit-job', projectId, jobId];
}

/**
 * How often to ask again while an edit runs.
 *
 * An apply is minutes of installing and building, so polling every second
 * would be a few hundred pointless requests per edit. It starts responsive —
 * the first stages turn over quickly — and backs off to a steady beat for the
 * long middle, where nothing changes for a minute at a time.
 */
function pollInterval(elapsedMs: number): number {
  if (elapsedMs < 15_000) return 1_500;
  if (elapsedMs < 60_000) return 4_000;
  return 8_000;
}

/**
 * One edit job, polled until it is over.
 *
 * Polling stops the moment the job reaches a terminal state — a finished job
 * never changes again, and a tab left open on a finished edit should cost
 * nothing.
 */
export function useEditJob(projectId: string | undefined, jobId: string | null) {
  return useQuery({
    queryKey: editJobKey(projectId, jobId),
    queryFn: () => {
      if (!projectId || !jobId) throw new Error('No edit job selected');
      return fetchEditJob(projectId, jobId);
    },
    enabled: Boolean(projectId) && Boolean(jobId),
    retry: false,
    refetchInterval: (query) => {
      const job = query.state.data;
      // No job in hand and an error already recorded: asking again every two
      // seconds forever is how a deleted or mistyped id becomes a permanent
      // background load.
      if (!job) return query.state.status === 'error' ? false : 2_000;
      if (isTerminalEditJob(job.status)) return false;
      const started = job.startedAt ?? job.createdAt;
      return pollInterval(Date.now() - new Date(started).getTime());
    },
    // A long edit outlives the window's focus, and a backgrounded tab that
    // stops polling shows a frozen stage when the reader comes back. The
    // interval is already seconds apart by then, so the cost is slight.
    refetchIntervalInBackground: true,
  });
}

/**
 * The edit this project is already running, asked once on load.
 *
 * Without this a reload looks idle while an edit is halfway through, and the
 * obvious next move — click Apply again — is the one thing that must not
 * happen.
 */
export function useCurrentEditJob(projectId: string | undefined) {
  return useQuery({
    queryKey: editJobKey(projectId, 'current'),
    queryFn: () => {
      if (!projectId) throw new Error('No project');
      return fetchCurrentEditJob(projectId);
    },
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 10_000,
  });
}

/**
 * Refresh what an applied edit changed.
 *
 * An accepted edit becomes the project's newest run, so its history, its
 * files and its graph have all moved. The apply mutation cannot do this —
 * when it returns, the work has not started — and nothing else was doing it,
 * so the Code tab and the run list sat stale until something else happened to
 * invalidate them.
 */
export function useRefreshOnAppliedEdit(projectId: string | undefined, job: EditJob | null): void {
  const queryClient = useQueryClient();
  const appliedRunId = job?.status === 'SUCCEEDED' ? job.runId : null;

  useEffect(() => {
    if (projectId === undefined || appliedRunId === null) return;
    void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'runs'] });
    void queryClient.invalidateQueries({ queryKey: ['graph', projectId] });
  }, [appliedRunId, projectId, queryClient]);
}

export function isTerminalEditJob(status: EditJobStatus): boolean {
  return (
    status === 'SUCCEEDED' ||
    status === 'REJECTED' ||
    status === 'FAILED' ||
    status === 'INTERRUPTED'
  );
}
