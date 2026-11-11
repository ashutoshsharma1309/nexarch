/**
 * What actually happened, and how long it took.
 *
 * Every other section here reports on the *project* — its review, its
 * validation, its dependencies. This one reports on the *run*: which stage
 * took the longest, how many model calls it made, what retried, what rolled
 * back. Those facts were already being measured and written to the server
 * log, where answering a question meant knowing the run id in advance and
 * having the file.
 *
 * Two honesty rules are load-bearing in this view:
 *
 *  - A figure nothing measured is shown as "not measured", never as zero. A
 *    run with no validation stage and a run whose validation took no time
 *    are different facts, and only one of them is interesting.
 *  - Timelines live in the server's memory and are lost on restart. The
 *    section says so rather than letting an empty list read as "this run
 *    did nothing".
 */
import { useState } from 'react';

import { Card, CardContent } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/cn';
import { useTimeline, useTimelines } from '@/shared/hooks/use-observability';
import { useWorkspace } from '../../workspace-context';
import type { TimelineEntry, TimelineSummary } from '@/shared/types/timeline';

/** Milliseconds, as a reader wants them. */
function ms(value: number): string {
  if (value < 1_000) return `${String(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${String(Math.floor(value / 60_000))}m ${String(Math.round((value % 60_000) / 1_000))}s`;
}

/** A measured figure, or an explicit statement that nothing measured it. */
function Measured({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-2xs font-medium text-fg-subtle">{label}</dt>
      <dd className={cn('font-mono text-sm', value === null ? 'text-fg-subtle' : 'text-fg')}>
        {value ?? 'not measured'}
      </dd>
    </div>
  );
}

function Summary({ summary }: { summary: TimelineSummary }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Measured
        label="Slowest stage"
        value={
          summary.slowestStage === null
            ? null
            : `${summary.slowestStage.stage} · ${ms(summary.slowestStage.durationMs)}`
        }
      />
      <Measured
        label="Stage time"
        value={summary.totalStageMs === null ? null : ms(summary.totalStageMs)}
      />
      <Measured
        label="Model calls"
        value={`${String(summary.modelCalls)}${summary.cachedModelCalls > 0 ? ` (${String(summary.cachedModelCalls)} cached)` : ''}`}
      />
      <Measured label="Retries" value={String(summary.retries)} />
      <Measured
        label="Validation"
        value={summary.validationMs === null ? null : ms(summary.validationMs)}
      />
      <Measured
        label="Repairs"
        value={
          summary.repairAttempts === 0
            ? '0'
            : `${String(summary.repairsFixed)} fixed of ${String(summary.repairAttempts)}`
        }
      />
      <Measured label="Rollbacks" value={String(summary.rollbacks)} />
      <Measured
        label="Cost"
        value={summary.costUsd === null ? null : `$${summary.costUsd.toFixed(4)}`}
      />
    </dl>
  );
}

/** The one line that explains a bad run, when there is one. */
function Trouble({ summary }: { summary: TimelineSummary }) {
  const bits: string[] = [];
  if (summary.failedAgents.length > 0)
    bits.push(`agents failed: ${summary.failedAgents.join(', ')}`);
  if (summary.degradedAgents.length > 0)
    bits.push(`fell back to a deterministic result: ${summary.degradedAgents.join(', ')}`);
  if (summary.failedModelCalls > 0)
    bits.push(`${String(summary.failedModelCalls)} model calls failed`);
  if (summary.validationsFailed > 0)
    bits.push(`${String(summary.validationsFailed)} validations failed`);
  if (summary.unexpectedProcessExits > 0)
    bits.push(`${String(summary.unexpectedProcessExits)} processes exited unexpectedly`);
  if (summary.firstFailureReason !== null)
    bits.push(`first failure: ${summary.firstFailureReason}`);
  if (bits.length === 0) return null;
  return (
    <p role="alert" className="mt-3 text-xs leading-relaxed text-warning">
      {bits.join(' · ')}
    </p>
  );
}

function Entries({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="mt-3 space-y-1" aria-label="Event sequence">
      {entries.map((entry, index) => {
        const event = entry.event;
        const duration = typeof event.durationMs === 'number' ? event.durationMs : null;
        // Every remaining field, in the order the server sent it. The events
        // carry no prompts and no generated files by design, so showing them
        // whole is safe and saves inventing a per-kind renderer for each of
        // the fourteen kinds.
        const detail = Object.entries(event)
          .filter(([key]) => key !== 'event' && key !== 'durationMs')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ');
        return (
          <li
            key={`${entry.at}-${String(index)}`}
            data-event={event.event}
            className="flex items-baseline gap-2 font-mono text-2xs"
          >
            <span className="shrink-0 text-fg-subtle">{entry.at.slice(11, 23)}</span>
            <span className="w-32 shrink-0 text-fg">{event.event}</span>
            <span className="min-w-0 flex-1 truncate text-fg-muted">{detail}</span>
            {duration !== null && (
              <span className="shrink-0 text-fg tabular-nums">{ms(duration)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ExecutionSection() {
  const workspace = useWorkspace();
  // Narrowed server-side. Filtering here against the project's run ids was
  // wrong: an edit job and a preview session are keyed by their own ids, so
  // a real edit's timeline — stages, model calls, validation, any rollback —
  // was dropped and the section claimed none was held.
  const timelines = useTimelines(workspace.project?.id);
  const [selected, setSelected] = useState<string | null>(null);

  const mine = timelines.data?.timelines ?? [];
  const key = selected ?? mine[0]?.key ?? null;
  const timeline = useTimeline(key);

  if (timelines.isPending) return <Skeleton className="h-40" />;

  if (timelines.isError) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-fg-muted">The execution timeline could not be read.</p>
        </CardContent>
      </Card>
    );
  }

  if (mine.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 py-6">
          <p className="text-sm text-fg">No execution timeline is held for this project.</p>
          <p className="text-xs leading-relaxed text-fg-muted">
            {/* Said plainly, because an empty list here does not mean the
                project never ran — it usually means the server restarted. */}
            Timelines are kept in the API process for recent executions only, so a restart clears
            them. The server log remains the durable record. Build or edit this project and the
            timeline for that run will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {mine.length > 1 && (
        <div
          className="-mx-1 flex gap-1 overflow-x-auto px-1"
          role="tablist"
          aria-label="Executions"
        >
          {mine.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={entry.key === key}
              onClick={() => {
                setSelected(entry.key);
              }}
              className={cn(
                'shrink-0 rounded-md border px-2.5 py-1 font-mono text-2xs transition-colors',
                entry.key === key
                  ? 'border-line-strong text-fg'
                  : 'border-line text-fg-muted hover:text-fg',
              )}
            >
              {entry.key.slice(0, 8)} · {String(entry.events)} events
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          {timeline.isPending && <Skeleton className="h-24" />}
          {timeline.isError && (
            <p className="text-sm text-fg-muted">
              That timeline is no longer held — the API process has restarted since it ran.
            </p>
          )}
          {timeline.data && (
            <>
              <Summary summary={timeline.data.summary} />
              <Trouble summary={timeline.data.summary} />
              {timeline.data.truncated && (
                <p className="mt-3 text-xs text-warning">
                  This run emitted more events than the timeline keeps. The sequence below is the
                  first part of it, not all of it.
                </p>
              )}
              <Entries entries={timeline.data.entries} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
