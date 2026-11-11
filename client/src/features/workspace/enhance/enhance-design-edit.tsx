/**
 * The image path of the workflow.
 *
 * Only the design-edit route reads an image, so a request with one attached
 * runs there. The review, progress and result screens are the edit panel's
 * own, reached here so that the two paths cannot drift apart.
 */
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  isTerminalEditJob,
  useApplyEdit,
  useEditJob,
  useEditPlan,
  useRefreshOnAppliedEdit,
} from '@/shared/hooks/use-project-edits';
import { toast } from '@/shared/store/toast.store';
import { Applying, JobOutcome } from '../tabs/edit/edit-panel';
import { EditPlanReview } from '../tabs/edit/edit-plan-review';
import { EditResultView } from '../tabs/edit/edit-result';
import type { SiteDesignView } from '@/shared/types/api';

const DESIGN_UNAVAILABLE =
  'The design this project was last built with is not loaded, so there is nothing to compare the proposal against until the project is rebuilt.';

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function EnhanceDesignEdit({
  projectId,
  planId,
  initialJobId,
  baselineDesign,
  onOpenPreview,
  onExit,
}: {
  projectId: string;
  planId: string;
  /** A design edit already running when this view opened. */
  initialJobId: string | null;
  /** Held from when the plan was written; "current" moves once it applies. */
  baselineDesign: SiteDesignView | null;
  onOpenPreview: () => void;
  onExit: () => void;
}) {
  const [jobId, setJobId] = useState(initialJobId);
  const plan = useEditPlan(projectId, planId);
  const apply = useApplyEdit(projectId);
  const job = useEditJob(projectId, jobId);
  useRefreshOnAppliedEdit(projectId, job.data ?? null);

  const watched = job.data ?? null;
  const running = watched !== null && !isTerminalEditJob(watched.status);
  const result = watched?.result ?? null;

  if (watched !== null && !running && result === null) {
    return <JobOutcome job={watched} onDismiss={onExit} />;
  }
  if (result !== null && plan.data) {
    return (
      <EditResultView
        plan={plan.data}
        result={result}
        currentDesign={baselineDesign}
        designUnavailableReason={DESIGN_UNAVAILABLE}
        onOpenPreview={onOpenPreview}
        onStartAnother={onExit}
      />
    );
  }
  if (running) return <Applying job={watched} failingToPoll={job.isError} />;
  if (plan.isError) {
    return (
      <div role="alert" className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
        <div>
          <p className="text-xs text-danger">
            {message(plan.error, 'This edit plan could not be read.')}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-2 text-xs text-accent underline underline-offset-2"
          >
            Start again
          </button>
        </div>
      </div>
    );
  }
  if (!plan.data || (jobId !== null && !job.data && !job.isError)) {
    return <Skeleton className="h-32" aria-busy="true" />;
  }

  const planData = plan.data;
  return (
    <>
      <EditPlanReview
        plan={planData}
        applying={apply.isPending}
        onApply={() => {
          if (apply.isPending) return;
          apply.mutate(planData.id, {
            onSuccess: (started) => {
              setJobId(started.id);
            },
            onError: (error) => {
              toast(message(error, 'The edit could not be applied'), 'error');
            },
          });
        }}
        onDiscard={onExit}
      />
      {apply.isError && (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-danger">
          {message(apply.error, 'The edit could not be applied.')}
        </p>
      )}
    </>
  );
}
