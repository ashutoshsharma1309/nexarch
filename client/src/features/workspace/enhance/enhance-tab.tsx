/**
 * Enhance: one continuous path from a request to a checked change.
 *
 * Request, plan, work, result, in that order and on one screen. Everything
 * shown comes from the server: the plan's own impact and research reasons,
 * the job's own stages, the event log, and checks that really ran.
 */
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card, CardContent } from '@/shared/components/ui/card';
import { PageHeader } from '@/shared/components/page-header';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  isEnhancementRunning,
  useApplyEnhancement,
  useCancelEnhancement,
  useCurrentEnhancementJob,
  useEnhancementEvents,
  useEnhancementJob,
  useHeldEnhancementPlan,
  usePlanEnhancement,
  useRefreshOnSettledEnhancement,
  useRevertEnhancement,
} from '@/shared/hooks/use-enhancement';
import {
  isTerminalEditJob,
  useCurrentEditJob,
  usePlanEdit,
} from '@/shared/hooks/use-project-edits';
import { cn } from '@/shared/lib/cn';
import type { EnhancementJob } from '@/shared/services/enhancement.service';
import { toast } from '@/shared/store/toast.store';
import type { SiteDesignView } from '@/shared/types/api';
import { BuildRequiredState } from '../tabs/build-required-state';
import { useWorkspace } from '../workspace-context';
import { EnhanceCompose } from './enhance-compose';
import { EnhanceDesignEdit } from './enhance-design-edit';
import { instructionWithLinks, researchPayload } from './enhance-model';
import type { ComposedEnhancement } from './enhance-model';
import { EnhancePlanReview } from './enhance-plan-review';
import { EnhanceProgress } from './enhance-progress';
import { EnhanceJobOutcome, EnhanceResult } from './enhance-result';

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type Step = 'request' | 'plan' | 'work' | 'result';

const STEPS: { id: Step; label: string }[] = [
  { id: 'request', label: 'Request' },
  { id: 'plan', label: 'Plan' },
  { id: 'work', label: 'Work' },
  { id: 'result', label: 'Result' },
];

function Stepper({ current }: { current: Step }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Enhancement steps">
      {STEPS.map((step, i) => (
        <li
          key={step.id}
          aria-current={i === index ? 'step' : undefined}
          className={cn(
            'flex items-center gap-2 text-xs',
            i === index ? 'font-medium text-fg' : i < index ? 'text-fg-muted' : 'text-fg-subtle',
          )}
        >
          {i > 0 && <span className="h-px w-4 bg-line-strong" aria-hidden="true" />}
          {step.label}
        </li>
      ))}
    </ol>
  );
}

const LAST_STATUS: Record<string, string> = {
  SUCCEEDED: 'applied',
  REJECTED: 'rejected',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  CANCELLED: 'cancelled',
};

function LastEnhancement({ job, onView }: { job: EnhancementJob; onView: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
      <p className="min-w-0 text-xs text-fg-muted">
        <span className="text-fg-subtle">
          Last enhancement, {LAST_STATUS[job.status] ?? job.status}:{' '}
        </span>
        {job.result?.outcome ?? job.error ?? job.instruction}
      </p>
      <button
        type="button"
        onClick={onView}
        className="text-xs text-accent underline underline-offset-2"
      >
        View result
      </button>
    </div>
  );
}

function EnhanceWorkflow({
  projectId,
  currentDesign,
  base,
}: {
  projectId: string;
  currentDesign: SiteDesignView | null;
  base: string;
}) {
  const navigate = useNavigate();
  const { plan, clear } = useHeldEnhancementPlan(projectId);
  const planEnhancement = usePlanEnhancement(projectId);
  const planDesignEdit = usePlanEdit(projectId);
  const apply = useApplyEnhancement(projectId);
  const cancel = useCancelEnhancement(projectId);
  const revert = useRevertEnhancement(projectId);
  const current = useCurrentEnhancementJob(projectId);
  const currentEdit = useCurrentEditJob(projectId);

  const [jobId, setJobId] = useState<string | null>(null);
  /** Stops a cached "still running" row from reopening what was just closed. */
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [designEdit, setDesignEdit] = useState<{
    planId: string;
    jobId: string | null;
    baseline: SiteDesignView | null;
  } | null>(null);
  const [restored, setRestored] = useState<{ runId: string; restoredRunId: string } | null>(null);

  const job = useEnhancementJob(projectId, jobId);
  const watched = job.data ?? null;
  const settled = watched !== null && isTerminalEditJob(watched.status);
  const events = useEnhancementEvents(projectId, jobId, settled);
  useRefreshOnSettledEnhancement(projectId, watched);

  // Adopt only work still running: a finished job is offered, not imposed.
  useEffect(() => {
    const latest = current.data;
    if (jobId === null && isEnhancementRunning(latest) && latest?.id !== dismissedJobId) {
      setJobId(latest?.id ?? null);
    }
  }, [current.data, dismissedJobId, jobId]);

  useEffect(() => {
    const latest = currentEdit.data;
    if (
      designEdit === null &&
      latest &&
      !isTerminalEditJob(latest.status) &&
      latest.id !== dismissedJobId
    ) {
      setDesignEdit({ planId: latest.planId, jobId: latest.id, baseline: null });
    }
  }, [currentEdit.data, designEdit, dismissedJobId]);

  const start = (planId: string): void => {
    if (apply.isPending) return;
    apply.mutate(planId, {
      onSuccess: (started) => {
        setJobId(started.id);
      },
      onError: (error) => {
        toast(message(error, 'The change could not be started'), 'error');
      },
    });
  };

  const reset = (): void => {
    setDismissedJobId(jobId);
    setJobId(null);
    setRestored(null);
    clear();
    planEnhancement.reset();
    planDesignEdit.reset();
    apply.reset();
    cancel.reset();
    revert.reset();
  };

  const submit = (composed: ComposedEnhancement): void => {
    const onError = (error: unknown): void => {
      toast(message(error, 'The change could not be planned'), 'error');
    };
    if (composed.image !== null) {
      const { dataUrl, kind, name } = composed.image;
      planDesignEdit.mutate(
        { instruction: composed.instruction, image: { dataUrl, kind, name } },
        {
          onSuccess: (created) => {
            setDesignEdit({ planId: created.id, jobId: null, baseline: currentDesign });
          },
          onError,
        },
      );
      return;
    }
    planEnhancement.mutate(
      {
        // With research off nothing will open a link, so it stays as text.
        ...(composed.research === 'off'
          ? { instruction: instructionWithLinks(composed.instruction, composed.referenceUrls) }
          : {
              instruction: composed.instruction,
              ...(composed.referenceUrls.length > 0
                ? { referenceUrls: composed.referenceUrls }
                : {}),
            }),
        ...researchPayload(composed.research),
      },
      {
        // A callback on this call only runs while this screen is mounted, so
        // a plan that returns after the tab was left waits for a person.
        onSuccess: (created) => {
          if (!created.substantial) start(created.planId);
        },
        onError,
      },
    );
  };

  const openPreview = (): void => {
    void navigate(`${base}/preview`);
  };

  if (designEdit !== null) {
    return (
      <EnhanceDesignEdit
        projectId={projectId}
        planId={designEdit.planId}
        initialJobId={designEdit.jobId}
        baselineDesign={designEdit.baseline}
        onOpenPreview={openPreview}
        onExit={() => {
          setDismissedJobId(designEdit.jobId);
          setDesignEdit(null);
          planDesignEdit.reset();
        }}
      />
    );
  }

  if (jobId !== null && watched === null) {
    if (job.isError) {
      return (
        <EnhanceReadFailure
          text={message(job.error, 'This enhancement could not be read.')}
          onRetry={reset}
        />
      );
    }
    return <Skeleton className="h-40" aria-busy="true" />;
  }

  if (watched !== null && !settled) {
    return (
      <>
        <Stepper current="work" />
        <EnhanceProgress
          job={watched}
          events={events.data ?? []}
          eventsFailing={events.isError}
          failingToPoll={job.isError}
          cancelling={cancel.isPending}
          cancelError={
            cancel.error === null ? null : message(cancel.error, 'It could not be cancelled.')
          }
          executionHref={`${base}/execution`}
          onCancel={() => {
            cancel.mutate(watched.id);
          }}
        />
      </>
    );
  }

  if (watched !== null) {
    return (
      <>
        <Stepper current="result" />
        {watched.result === null ? (
          <EnhanceJobOutcome job={watched} onDismiss={reset} />
        ) : (
          <EnhanceResult
            job={watched}
            result={watched.result}
            reverting={revert.isPending}
            revertError={
              revert.error === null ? null : message(revert.error, 'It could not be reverted.')
            }
            restored={restored}
            onRevert={() => {
              revert.mutate(watched.id, { onSuccess: setRestored });
            }}
            onOpenPreview={openPreview}
            onStartAnother={reset}
          />
        )}
      </>
    );
  }

  if (plan !== null) {
    return (
      <>
        <Stepper current="plan" />
        <EnhancePlanReview
          plan={plan}
          applying={apply.isPending}
          error={apply.error === null ? null : message(apply.error, 'It could not be started.')}
          onApprove={() => {
            start(plan.planId);
          }}
          onDiscard={reset}
        />
      </>
    );
  }

  const planError = planEnhancement.error ?? planDesignEdit.error;
  const last = current.data;
  return (
    <>
      <Stepper current="request" />
      <Card>
        <CardContent>
          <EnhanceCompose
            planning={planEnhancement.isPending || planDesignEdit.isPending}
            error={
              planError === null ? null : message(planError, 'The change could not be planned.')
            }
            onSubmit={submit}
          />
          {last && isTerminalEditJob(last.status) && (
            <LastEnhancement
              job={last}
              onView={() => {
                setRestored(null);
                setJobId(last.id);
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function EnhanceReadFailure({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <div>
        <p className="text-xs text-danger">{text}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs text-accent underline underline-offset-2"
        >
          Start again
        </button>
      </div>
    </div>
  );
}

export function EnhanceTab() {
  const workspace = useWorkspace();
  const projectId = workspace.project?.id;

  if (!projectId || !workspace.latestRun) return <BuildRequiredState what="enhancements" />;

  return (
    <div className="space-y-4">
      <PageHeader
        variant="section"
        title="Enhance"
        description="Change what is already built. Every change is planned against the project, built and tested before it replaces anything."
      />
      {workspace.isBuilding ? (
        <p className="rounded-md border border-line bg-inset px-3 py-2 text-xs text-fg-muted">
          A build is running. Enhancements start from the latest finished build, so this opens again
          when it completes.
        </p>
      ) : (
        <EnhanceWorkflow
          key={projectId}
          projectId={projectId}
          currentDesign={workspace.artifacts?.siteDesign ?? null}
          base={`/projects/${projectId}`}
        />
      )}
    </div>
  );
}
