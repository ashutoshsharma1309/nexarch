/**
 * What each build and enhancement really did, from the persisted event log and
 * then the live stream. A refresh restores the same picture because the log,
 * not this page, is the record. Nothing moves here unless an event arrived.
 */
import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  useExecutionFeed,
  useExecutionJobs,
  useExecutionUsage,
} from '@/shared/hooks/use-execution';
import type { ExecutionFeedState, FeedConnection } from '@/shared/services/execution-feed';
import type { ExecutionJobSummary } from '@/shared/types/execution';
import type { PipelineRun } from '@/shared/types/api';
import { useWorkspace } from '../workspace-context';
import { formatClock, formatDateTime, formatDuration, usageLines } from './execution-format';
import { buildExecutionView, usageRevision } from './execution-model';
import type { ExecutionDisplayStatus, ExecutionView, PlannedStage } from './execution-model';
import { ExecutionStage, FileChangesList } from './execution-stage';

const ICON = <Activity className="size-4" />;

const STATUS: Record<
  ExecutionDisplayStatus,
  { label: string; variant: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }
> = {
  queued: { label: 'Queued', variant: 'neutral' },
  researching: { label: 'Researching', variant: 'accent' },
  planning: { label: 'Planning', variant: 'accent' },
  implementing: { label: 'Implementing', variant: 'accent' },
  testing: { label: 'Testing', variant: 'accent' },
  repairing: { label: 'Repairing', variant: 'warning' },
  working: { label: 'Running', variant: 'accent' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'warning' },
  interrupted: { label: 'Interrupted', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'danger' },
  unknown: { label: 'Status unknown', variant: 'neutral' },
};

const CONNECTION: Record<FeedConnection, string> = {
  loading: 'Reading the recorded history',
  connecting: 'Connecting to the live feed',
  live: 'Live',
  reconnecting: 'Connection lost, reconnecting',
  polling: 'Live feed unavailable, checking for new events periodically',
  ended: 'No further events expected',
  error: 'Not connected',
};

/** The order the enhancement worker runs in. Research and repair do not always happen. */
const ENHANCEMENT_PLAN: PlannedStage[] = [
  {
    id: 'researching',
    label: 'Researching',
    responsibility: 'Runs only when research was requested.',
  },
  { id: 'planning', label: 'Planning' },
  { id: 'implementing', label: 'Implementing' },
  { id: 'testing', label: 'Testing' },
  {
    id: 'repairing',
    label: 'Repairing',
    responsibility: 'Runs only if testing proves something is broken.',
  },
];

function planFor(job: ExecutionJobSummary, liveRun: PipelineRun | undefined): PlannedStage[] {
  if (job.jobKind === 'ENHANCEMENT') return ENHANCEMENT_PLAN;
  if (liveRun?.id !== job.jobId) return [];
  return liveRun.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    status: stage.status,
    agentId: stage.agentId,
    engine: stage.engine,
    responsibility: stage.responsibility ?? null,
  }));
}

function jobLabel(job: ExecutionJobSummary): string {
  const kind = job.jobKind === 'ENHANCEMENT' ? 'Enhancement' : 'Build';
  return `${kind}: ${job.title ?? job.jobId.slice(0, 8)} (${formatDateTime(job.createdAt)})`;
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs text-fg-subtle">{term}</dt>
      <dd className="text-xs break-words text-fg">{value}</dd>
    </div>
  );
}

function Summary({ view, feed }: { view: ExecutionView; feed: ExecutionFeedState }) {
  const status = STATUS[view.status];
  const usage = usageLines(view.usage);
  const fileCount =
    view.files.created.length + view.files.modified.length + view.files.deleted.length;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-2xs text-fg-subtle">{CONNECTION[feed.connection]}</span>
        </div>
        {view.isActive && (
          <div role="status" aria-live="polite" className="text-xs leading-relaxed text-fg">
            {view.currentStage && (
              <p className="font-medium">
                {view.currentStage.label}
                {view.currentStage.agentId ? ` (${view.currentStage.agentId})` : ''}
              </p>
            )}
            <p className="break-words text-fg-muted">
              {view.currentOperation ?? 'Waiting for the first recorded event.'}
            </p>
            {view.lastEventAt && (
              <p className="mt-1 text-2xs text-fg-subtle">
                Latest event at {formatClock(view.lastEventAt)}. This page updates only when the
                server records something new.
              </p>
            )}
          </div>
        )}
        {feed.error && (
          <p role="alert" className="text-xs text-danger">
            {feed.error}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Fact term="Started" value={formatClock(view.startedAt)} />
          <Fact
            term="Duration"
            value={
              view.status === 'queued'
                ? 'Not started'
                : view.isActive
                  ? 'Still running'
                  : formatDuration(view.durationMs)
            }
          />
          <Fact term="Tokens" value={usage.tokens} />
          <Fact term="Cost" value={usage.cost} />
        </dl>
        {view.errors.length > 0 && (
          <ul className="space-y-1 text-xs break-words text-danger">
            {view.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {view.verification && (
          <p className={view.verification.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
            {view.verification.ok
              ? 'Build verification passed.'
              : `Build verification failed: ${view.verification.failed.join(', ') || 'see Testing below'}.`}
          </p>
        )}
        {fileCount > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
              Files changed ({fileCount})
            </summary>
            <div className="mt-2">
              <FileChangesList files={view.files} />
            </div>
          </details>
        )}
        <p className="text-2xs text-fg-subtle">
          Files agents read are not recorded by the server, only files they changed.
        </p>
        {view.notes.map((note) => (
          <p key={note.seq} className="text-xs text-fg-muted">
            {note.message}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function Timeline({
  projectId,
  job,
  liveRun,
}: {
  projectId: string;
  job: ExecutionJobSummary;
  liveRun: PipelineRun | undefined;
}) {
  const { feed, reconnect } = useExecutionFeed(projectId, job.jobId);
  const revision = usageRevision(feed.events);
  const usage = useExecutionUsage(projectId, job.jobId, revision);
  const view = useMemo(
    () =>
      buildExecutionView({
        jobKind: job.jobKind,
        events: feed.events,
        usage: usage.data ?? [],
        summary: job,
        plan: planFor(job, liveRun),
        feedEnded: feed.connection === 'ended',
      }),
    [job, feed.events, feed.connection, usage.data, liveRun],
  );

  if (!feed.historyLoaded && feed.connection !== 'error') {
    return (
      <div role="status" aria-label="Loading execution history" className="space-y-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (feed.connection === 'error' && feed.events.length === 0) {
    return (
      <EmptyState
        icon={ICON}
        title="Could not load this execution"
        description={feed.error ?? 'The request failed.'}
        action={<Button onClick={reconnect}>Try again</Button>}
      />
    );
  }
  if (!view.hasHistory && !view.isActive) {
    return (
      <EmptyState
        icon={ICON}
        title="No execution history recorded for this run"
        description="This job ran before execution history was kept, or nothing was recorded for it."
      />
    );
  }

  return (
    <div className="space-y-3">
      <Summary view={view} feed={feed} />
      {feed.connection === 'error' && <Button onClick={reconnect}>Reconnect</Button>}
      {view.stages.length === 0 ? (
        <p className="text-xs text-fg-subtle">No stages recorded yet.</p>
      ) : (
        <ol className="space-y-2" aria-label="Stages">
          {view.stages.map((stage) => (
            <ExecutionStage key={stage.id} stage={stage} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function ExecutionTab() {
  const workspace = useWorkspace();
  const projectId = workspace.project?.id;
  const jobs = useExecutionJobs(projectId, workspace.isBuilding);
  const [chosenId, setChosenId] = useState<string | null>(null);

  if (workspace.isLoading || jobs.isPending) {
    return (
      <div role="status" aria-label="Loading executions" className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (jobs.isError) {
    return (
      <EmptyState
        icon={ICON}
        title="Could not load executions"
        description={jobs.error.message}
        action={
          <Button
            onClick={() => {
              void jobs.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }
  const list = jobs.data;
  // Follows the newest job until the viewer picks one, so a new build appears by itself.
  const job = list.find((row) => row.jobId === chosenId) ?? list[0];
  if (!job || !projectId) {
    return (
      <EmptyState
        icon={ICON}
        title={
          workspace.isBuilding
            ? 'Waiting for the build to record its first event'
            : 'No executions recorded yet'
        }
        description="Builds and enhancements of this project appear here with what each one really did."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <label htmlFor="execution-job" className="text-xs text-fg-muted">
          Execution
        </label>
        <select
          id="execution-job"
          value={job.jobId}
          onChange={(event) => {
            setChosenId(event.target.value);
          }}
          className="h-8 max-w-full min-w-0 rounded-md border border-line bg-surface px-2 text-xs text-fg"
        >
          {list.map((row) => (
            <option key={row.jobId} value={row.jobId}>
              {jobLabel(row)}
            </option>
          ))}
        </select>
      </div>
      <Timeline key={job.jobId} projectId={projectId} job={job} liveRun={workspace.liveRun} />
    </div>
  );
}
