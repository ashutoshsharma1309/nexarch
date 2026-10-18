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
import { useApplyEdit, useEditPlan, usePlanEdit } from '@/shared/hooks/use-project-edits';
import { cn } from '@/shared/lib/cn';
import { ApiClientError } from '@/shared/services/api-client';
import { toast } from '@/shared/store/toast.store';
import { EditCompose } from './edit-compose';
import { EditPlanReview } from './edit-plan-review';
import { EditResultView } from './edit-result';
import type { EditResult, SiteDesignView } from '@/shared/types/api';

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
  if (error instanceof ApiClientError && error.status !== undefined) {
    return 'The project was left as it was — an edit only replaces it once it has built and started.';
  }
  return 'Whether the server finished applying it cannot be told from here. Reload the project to see which version it holds.';
}

/**
 * The two minutes an apply takes.
 *
 * The server answers once, at the end: there is no progress stream, and the
 * steps below are the plan's own list rather than a guess at which one is
 * running now. So this shows the real elapsed time and the real list, and
 * says plainly that the stages are not reported individually. A bar creeping
 * towards 90% would be an invention, and this console does not invent
 * evidence anywhere else.
 */
function Applying({ steps }: { steps: string[] }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed((seconds) => seconds + 1);
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div aria-live="polite" aria-busy="true" className="rounded-md border border-line bg-inset p-4">
      <p className="flex items-center gap-2 text-sm text-fg">
        <Spinner className="size-3.5" />
        Applying the edit — building and checking the edited project
      </p>
      <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
        {minutes}:{String(seconds).padStart(2, '0')} elapsed · one to two minutes is normal
      </p>
      <ul className="mt-3 space-y-1">
        {steps.map((step) => (
          <li key={step} className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="size-1.5 rounded-full bg-line-strong" aria-hidden="true" />
            {step}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-2xs leading-relaxed text-fg-subtle">
        These run on the server in one call and it answers when they are done, so there is no
        per-step progress to show. Leaving this tab does not cancel the work, but the result is only
        reported here.
      </p>
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
  const [result, setResult] = useState<EditResult | null>(null);
  /**
   * The design the plan was written against, held from the moment it was
   * written. An applied edit becomes the project's newest run, so seconds
   * later the workspace's "current" design *is* the edited one — reading it
   * live would quietly compare the new design against itself and call
   * everything unchanged.
   */
  const [baselineDesign, setBaselineDesign] = useState<SiteDesignView | null>(null);

  const plan = useEditPlan(projectId, planId);
  const planEdit = usePlanEdit(projectId);
  const apply = useApplyEdit(projectId);

  const reset = (): void => {
    setPlanId(null);
    setResult(null);
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
            {result !== null && plan.data ? (
              <EditResultView
                plan={plan.data}
                result={result}
                currentDesign={baselineDesign}
                designUnavailableReason={DESIGN_UNAVAILABLE}
                onOpenPreview={onOpenPreview}
                onStartAnother={reset}
              />
            ) : apply.isPending && plan.data ? (
              <Applying steps={plan.data.validationPlan} />
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
                  apply.mutate(plan.data.id, {
                    onSuccess: (applied) => {
                      setResult(applied);
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
