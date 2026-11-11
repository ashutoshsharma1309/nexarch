/**
 * Step three: the work, as it really happens.
 *
 * The stages are the job row's, with the times the server recorded, and the
 * activity below is the event log. There is no percentage and no estimate:
 * how long an install or a repair will take is not known here, and a number
 * would be an invention.
 */
import { CircleSlash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/lib/cn';
import type { EnhancementJob } from '@/shared/services/enhancement.service';
import type { ExecutionEvent } from '@/shared/types/execution';
import { formatElapsed, stageLabel } from './enhance-model';

/** Model calls are noise here; the Execution tab keeps the whole log. */
const FEED_HIDDEN_TYPES = new Set(['model.call', 'job.started']);
const FEED_LIMIT = 40;

const STATUS_DOT: Record<string, string> = {
  succeeded: 'bg-success',
  failed: 'bg-danger',
  cancelled: 'bg-warning',
  skipped: 'bg-line-strong',
};

function dotClass(event: ExecutionEvent): string {
  return (event.status === null ? undefined : STATUS_DOT[event.status]) ?? 'bg-accent';
}

function ActivityFeed({
  events,
  failing,
  executionHref,
}: {
  events: ExecutionEvent[];
  failing: boolean;
  executionHref: string;
}) {
  const shown = events.filter((event) => !FEED_HIDDEN_TYPES.has(event.type));
  const earlier = Math.max(0, shown.length - FEED_LIMIT);
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-2xs font-medium text-fg-subtle">Activity</p>
      {failing && (
        <p role="status" className="mt-1 text-xs text-warning">
          The activity log could not be read just now. The stages above are still the job&rsquo;s
          own.
        </p>
      )}
      {shown.length === 0 && !failing ? (
        <p className="mt-1 text-xs text-fg-muted">Nothing recorded yet.</p>
      ) : (
        <ol className="mt-1.5 space-y-1" aria-label="Enhancement activity">
          {shown.slice(earlier).map((event) => (
            <li key={event.seq} className="flex items-start gap-2 text-xs" data-type={event.type}>
              <span
                className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', dotClass(event))}
                aria-hidden="true"
              />
              <span className="min-w-0 break-words text-fg-muted">{event.message}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-2xs text-fg-subtle">
        {earlier > 0 && `${String(earlier)} earlier entries are not shown. `}
        <Link to={executionHref} className="text-accent underline underline-offset-2">
          Open the full execution log
        </Link>
      </p>
    </div>
  );
}

export function EnhanceProgress({
  job,
  events,
  eventsFailing,
  failingToPoll,
  cancelling,
  cancelError,
  executionHref,
  onCancel,
}: {
  job: EnhancementJob;
  events: ExecutionEvent[];
  eventsFailing: boolean;
  failingToPoll: boolean;
  cancelling: boolean;
  cancelError: string | null;
  executionHref: string;
  onCancel: () => void;
}) {
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
  const stopping = job.cancelRequested || cancelling;

  return (
    <div aria-live="polite" aria-busy="true" className="rounded-md border border-line bg-inset p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-fg">
            <Spinner className="size-3.5" />
            {stageLabel(job.stage)}
          </p>
          <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
            {formatElapsed(elapsed)} elapsed
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={stopping}
          icon={<CircleSlash className="size-3.5" />}
          onClick={onCancel}
        >
          {stopping ? 'Stopping…' : 'Cancel'}
        </Button>
      </div>

      {stopping && (
        <p role="status" className="mt-2 text-xs text-warning">
          Stopping at the next safe point. The project keeps its current files.
        </p>
      )}
      {cancelError !== null && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {cancelError}
        </p>
      )}

      <ol className="mt-3 space-y-1" aria-label="Enhancement stages">
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
                className="flex flex-wrap items-center gap-x-2 text-xs"
                data-stage={record.stage}
                data-done={done}
              >
                <span
                  className={cn('size-1.5 rounded-full', done ? 'bg-success' : 'bg-accent')}
                  aria-hidden="true"
                />
                <span className={done ? 'text-fg-muted' : 'text-fg'}>
                  {stageLabel(record.stage)}
                </span>
                {took !== null && (
                  <span className="font-mono text-2xs text-fg-subtle tabular-nums">{took}s</span>
                )}
                {record.detail !== null && (
                  <span className="text-2xs text-fg-subtle">{record.detail}</span>
                )}
              </li>
            );
          })}
      </ol>

      <ActivityFeed events={events} failing={eventsFailing} executionHref={executionHref} />

      {failingToPoll && (
        <p role="status" className="mt-3 text-2xs leading-relaxed text-warning">
          Not reachable right now, so this may be out of date. The work runs on the server and is
          unaffected; this will catch up when the connection comes back.
        </p>
      )}
      <p className="mt-3 text-2xs leading-relaxed text-fg-subtle">
        Closing this tab or reloading does not stop it. Reopen the project and it will still be
        here.
      </p>
    </div>
  );
}
