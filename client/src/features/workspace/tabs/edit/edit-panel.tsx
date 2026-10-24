/**
 * "Modify this project" — an edit, rather than another build.
 *
 * It lives below the rebuild prompt and stays folded away, because the two
 * are not alternatives of equal weight: rebuilding answers "what should this
 * be?" from scratch, editing answers "what should change about what this
 * already is?". Someone who wants the second thing knows it; someone who
 * wants the first should not have to pick it out of two equally loud panels.
 *
 * Four states, in order, in this one panel: compose, review, apply, result.
 * The plan is kept by id and read through the query cache rather than held as
 * a component value, so re-rendering — or returning to this tab — shows the
 * same plan instead of a fresh form.
 */
import { AlertTriangle, ChevronRight, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import {
  isTerminalEditJob,
  useApplyEdit,
  useCurrentEditJob,
  useEditJob,
  useEditPlan,
  usePlanEdit,
  useRefreshOnAppliedEdit,
} from '@/shared/hooks/use-project-edits';
import { cn } from '@/shared/lib/cn';
import { ApiClientError } from '@/shared/services/api-client';
import { toast } from '@/shared/store/toast.store';
import { EditCompose } from './edit-compose';
import { EditPlanReview } from './edit-plan-review';
import { EditResultView } from './edit-result';
import type { EditJob, EditStage, SiteDesignView } from '@/shared/types/api';

const DESIGN_UNAVAILABLE =
  'The design this project was last built with is not loaded — the server holds a build’s output in memory, so a restart drops it. There is nothing to compare the proposal against until the project is rebuilt.';

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * What a failed apply leaves behind — and only what is actually known.
 *
 * An edit becomes the project only after it has built and started, so a
 * refusal the server itself sent means the project was never touched. A
 * transport failure is a different thing: the request may have died on the
 * way back from work that finished, and "nothing was written" would then be
 * a guess dressed as a guarantee.
 */
function aftermath(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 409) {
    // Another edit is mid-apply and may replace the project at any moment, so
    // "left as it was" would be true of this request and false of the project.
    return 'Nothing was started by this attempt. The edit already running may still change the project.';
  }
  if (error instanceof ApiClientError && error.status !== undefined) {
    return 'The project was left as it was — an edit only replaces it once it has built and started.';
  }
  return 'Whether the server finished applying it cannot be told from here. Reload the project to see which version it holds.';
}

/**
 * The two minutes an apply takes.
 *
 * The stages are the server's own, each with the time it started and
 * finished, so what is shown is measured rather than animated. There is still
 * no percentage: a bar creeping towards 90% would be an invention, and this
 * console does not invent evidence anywhere else.
 */
const STAGE_LABEL: Record<EditStage, string> = {
  queued: 'Queued',
  rebuilding: 'Rebuilding the project with the edit',
  validating: 'Installing, building, type-checking and starting it',
  deciding: 'Deciding whether to keep the edit',
  finished: 'Finished',
};

function Applying({ job, failingToPoll }: { job: EditJob; failingToPoll: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const started = new Date(job.startedAt ?? job.createdAt).getTime();
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div aria-live="polite" aria-busy="true" className="rounded-md border border-line bg-inset p-4">
      <p className="flex items-center gap-2 text-sm text-fg">
        <Spinner className="size-3.5" />
        {STAGE_LABEL[job.stage]}
      </p>
      <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
        {minutes}:{String(seconds).padStart(2, '0')} elapsed · five to six minutes is normal
      </p>
      <ol className="mt-3 space-y-1">
        {job.stages
          .filter((record) => record.stage !== 'queued')
          .map((record) => {
            const done = record.completedAt !== null;
            const took =
              record.completedAt === null
                ? null
                : Math.round(
                    (new Date(record.completedAt).getTime() -
                      new Date(record.startedAt).getTime()) /
                      1000,
                  );
            return (
              <li
                key={`${record.stage}-${record.startedAt}`}
                className="flex items-center gap-2 text-xs"
                data-stage={record.stage}
                data-done={done}
              >
                <span
                  className={cn('size-1.5 rounded-full', done ? 'bg-success' : 'bg-accent')}
                  aria-hidden="true"
                />
                <span className={done ? 'text-fg-muted' : 'text-fg'}>
                  {STAGE_LABEL[record.stage]}
                </span>
                {took !== null && (
                  <span className="font-mono text-2xs text-fg-subtle tabular-nums">{took}s</span>
                )}
              </li>
            );
          })}
      </ol>
      {failingToPoll && (
        <p role="status" className="mt-3 text-2xs leading-relaxed text-warning">
          Not reachable right now, so this may be out of date. The edit itself is unaffected — it
          runs on the server — and this will catch up when the connection comes back.
        </p>
      )}
      <p className="mt-3 text-2xs leading-relaxed text-fg-subtle">
        The work runs on the server, so closing this tab or reloading does not cancel it — reopen
        the project and it will still be here.
      </p>
    </div>
  );
}

/**
 * A job that ended without a result to show.
 *
 * FAILED and INTERRUPTED carry an explanation and nothing else, and the panel
 * used to fall straight through them back to the plan screen — so the one row
 * the durable table exists for, the interrupted edit, reached no user at all,
 * and "Apply edit" was offered again as though nothing had happened.
 */
function JobOutcome({ job, onDismiss }: { job: EditJob; onDismiss: () => void }) {
  const interrupted = job.status === 'INTERRUPTED';
  return (
    <div
      role="alert"
      className="rounded-md border border-line bg-inset p-4"
      data-status={job.status}
    >
      <p className="flex items-center gap-2 text-sm text-fg">
        <AlertTriangle
          className={cn('size-3.5 shrink-0', interrupted ? 'text-warning' : 'text-danger')}
        />
        {interrupted ? 'This edit was interrupted' : 'This edit could not be applied'}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">
        {job.error ??
          'The server did not say why. The project still has the files it had before the edit started.'}
      </p>
      <p className="mt-2 text-2xs text-fg-subtle">&ldquo;{job.instruction}&rdquo;</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 text-xs text-accent underline underline-offset-2"
      >
        Start again
      </button>
    </div>
  );
}

export function EditPanel({
  projectId,
  currentDesign,
  onOpenPreview,
}: {
  projectId: string;
  /** The design the project was last built with, when it is still loaded. */
  currentDesign: SiteDesignView | null;
  onOpenPreview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  /**
   * The job being watched. Seeded from the server on load, so a reload or a
   * second tab shows the edit already running instead of looking idle and
   * inviting a duplicate.
   */
  const [jobId, setJobId] = useState<string | null>(null);
  /**
   * The design the plan was written against, held from the moment it was
   * written. An applied edit becomes the project's newest run, so seconds
   * later the workspace's "current" design *is* the edited one — reading it
   * live would quietly compare the new design against itself and call
   * everything unchanged.
   */
  const [baselineDesign, setBaselineDesign] = useState<SiteDesignView | null>(null);
  /**
   * The outcome the reader has already dealt with.
   *
   * Dismissing one sets `jobId` back to null, which re-runs the adoption
   * effect below against the same still-cached `current` row — so without
   * this, "Start again" put the very outcome it had just dismissed straight
   * back on screen, and there was no way to leave it but a reload.
   */
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);

  const plan = useEditPlan(projectId, planId);
  const planEdit = usePlanEdit(projectId);
  const apply = useApplyEdit(projectId);
  const currentJob = useCurrentEditJob(projectId);
  const job = useEditJob(projectId, jobId);

  // Adopt whatever this project is already doing. Only a job still running is
  // adopted: a finished one belongs to a session that has been and gone, and
  // re-opening its result would be confusing rather than helpful.
  useEffect(() => {
    const latest = currentJob.data;
    if (latest && latest.id === dismissedJobId) return;
    if (jobId === null && latest && !isTerminalEditJob(latest.status)) {
      setJobId(latest.id);
      setPlanId(latest.planId);
      setOpen(true);
    }
    // An edit that ended badly while nobody was looking — the server
    // restarted under it, say — is adopted too, but only inside the panel the
    // reader already opened: it is news they need, not a reason to seize the
    // page.
    if (jobId === null && latest && isTerminalEditJob(latest.status) && latest.result === null) {
      setJobId(latest.id);
    }
  }, [currentJob.data, jobId, dismissedJobId]);

  const watched = job.data ?? null;

  const running = watched !== null && !isTerminalEditJob(watched.status);
  const result = watched?.result ?? null;
  useRefreshOnAppliedEdit(projectId, job.data ?? null);

  /** Terminal, and nothing to show but why — FAILED or INTERRUPTED. */
  const outcomeOnly = watched !== null && !running && result === null;
  /**
   * A job id adopted or just started, whose first read has not answered yet.
   * Treated as busy: showing the plan with an enabled Apply during that gap
   * invites exactly the duplicate the job model exists to prevent.
   */
  const awaitingJob = jobId !== null && job.data === undefined && !job.isError;

  const reset = (): void => {
    setDismissedJobId(jobId);
    setPlanId(null);
    setJobId(null);
    setBaselineDesign(null);
    planEdit.reset();
    apply.reset();
  };

  return (
    <section aria-label="Modify this project">
      <Card>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-raised"
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-fg-subtle transition-transform',
              open && 'rotate-90',
            )}
          />
          <Pencil className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="text-sm font-medium text-fg">Modify this project</span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
            Change what is already built — with a screenshot or mockup, if you have one.
          </span>
        </button>

        {open && (
          <CardContent className="border-t border-line">
            {outcomeOnly ? (
              <JobOutcome job={watched} onDismiss={reset} />
            ) : result !== null && plan.data ? (
              <EditResultView
                plan={plan.data}
                result={result}
                currentDesign={baselineDesign}
                designUnavailableReason={DESIGN_UNAVAILABLE}
                onOpenPreview={onOpenPreview}
                onStartAnother={reset}
              />
            ) : running ? (
              <Applying job={watched} failingToPoll={job.isError} />
            ) : awaitingJob ? (
              <div className="space-y-3" aria-busy="true" aria-label="Reading the edit in progress">
                <Skeleton className="h-24" />
              </div>
            ) : planId === null ? (
              <EditCompose
                planning={planEdit.isPending}
                error={
                  planEdit.error === null
                    ? null
                    : message(planEdit.error, 'The edit could not be planned.')
                }
                onSubmit={(edit) => {
                  planEdit.mutate(
                    {
                      instruction: edit.instruction,
                      ...(edit.image
                        ? {
                            image: {
                              dataUrl: edit.image.dataUrl,
                              kind: edit.image.kind,
                              name: edit.image.name,
                            },
                          }
                        : {}),
                    },
                    {
                      onSuccess: (created) => {
                        setPlanId(created.id);
                        setBaselineDesign(currentDesign);
                      },
                      // The inline message is the one that matters — it names
                      // the limit and what to try — but a toast is how every
                      // other mutation in the console reports a failure.
                      onError: (error) => {
                        toast(message(error, 'The edit could not be planned'), 'error');
                      },
                    },
                  );
                }}
              />
            ) : plan.isPending ? (
              <div className="space-y-3" aria-busy="true" aria-label="Loading the edit plan">
                <Skeleton className="h-16" />
                <Skeleton className="h-32" />
              </div>
            ) : plan.isError ? (
              <div role="alert" className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <div>
                  <p className="text-xs text-danger">
                    {message(plan.error, 'This edit plan could not be read.')}
                  </p>
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-2 text-xs text-accent underline underline-offset-2"
                  >
                    Start again
                  </button>
                </div>
              </div>
            ) : (
              <EditPlanReview
                plan={plan.data}
                applying={apply.isPending}
                onApply={() => {
                  // This guards the double-click. It is not the real
                  // protection: a second tab has its own state, so the server
                  // refuses a second active job for the project regardless.
                  if (apply.isPending) return;
                  apply.mutate(plan.data.id, {
                    onSuccess: (started) => {
                      setJobId(started.id);
                    },
                    onError: (error) => {
                      toast(message(error, 'The edit could not be applied'), 'error');
                    },
                  });
                }}
                onDiscard={reset}
              />
            )}

            {apply.isError && (
              <div role="alert" className="mt-3 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <p className="text-xs leading-relaxed text-danger">
                  {message(apply.error, 'The edit could not be applied.')}{' '}
                  <span className="text-fg-muted">{aftermath(apply.error)}</span>
                </p>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </section>
  );
}
