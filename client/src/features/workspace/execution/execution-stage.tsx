/** One stage of a job: a row that says where it stands, and the record behind it. */
import { CheckCircle2, Circle, CircleSlash, Clock3, Loader2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/cn';
import { hostOf } from '../research/research-links';
import { SafeExternalLink } from '../research/research-shared';
import { formatClock, formatDuration, usageLines } from './execution-format';
import type { FileChanges, StageDisplayStatus, StageView } from './execution-model';

const STATUS: Record<
  StageDisplayStatus,
  {
    label: string;
    variant: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
    icon: ReactNode;
  }
> = {
  pending: {
    label: 'Pending',
    variant: 'neutral',
    icon: <Circle className="size-4 text-fg-subtle" />,
  },
  running: {
    label: 'In progress',
    variant: 'accent',
    icon: <Loader2 className="size-4 animate-spin text-accent motion-reduce:animate-none" />,
  },
  completed: {
    label: 'Completed',
    variant: 'success',
    icon: <CheckCircle2 className="size-4 text-success" />,
  },
  failed: { label: 'Failed', variant: 'danger', icon: <XCircle className="size-4 text-danger" /> },
  skipped: {
    label: 'Skipped',
    variant: 'neutral',
    icon: <CircleSlash className="size-4 text-fg-subtle" />,
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'warning',
    icon: <CircleSlash className="size-4 text-warning" />,
  },
  interrupted: {
    label: 'Interrupted',
    variant: 'warning',
    icon: <CircleSlash className="size-4 text-warning" />,
  },
  recorded: {
    label: 'Recorded',
    variant: 'neutral',
    icon: <Clock3 className="size-4 text-fg-subtle" />,
  },
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h5 className="mb-1 text-2xs font-medium text-fg-subtle">{title}</h5>
      {children}
    </div>
  );
}

function Paths({ paths }: { paths: string[] }) {
  return (
    <ul className="space-y-0.5 font-mono text-2xs break-all text-fg-muted">
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

export function FileChangesList({ files }: { files: FileChanges }) {
  return (
    <div className="space-y-2">
      {files.created.length > 0 && (
        <Group title={`Created (${String(files.created.length)})`}>
          <Paths paths={files.created} />
        </Group>
      )}
      {files.modified.length > 0 && (
        <Group title={`Modified (${String(files.modified.length)})`}>
          <Paths paths={files.modified} />
        </Group>
      )}
      {files.deleted.length > 0 && (
        <Group title={`Deleted (${String(files.deleted.length)})`}>
          <Paths paths={files.deleted} />
        </Group>
      )}
    </div>
  );
}

function hasFiles(files: FileChanges): boolean {
  return files.created.length + files.modified.length + files.deleted.length > 0;
}

function Details({ stage }: { stage: StageView }) {
  const usage = usageLines(stage.usage);
  return (
    <div className="mt-3 space-y-3">
      {stage.error && (
        <Group title="Error">
          <p className="text-xs break-words text-danger">{stage.error}</p>
        </Group>
      )}
      {stage.researchFromPlanning && (
        <p className="text-xs text-fg-subtle">
          This research ran during planning, before this job started.
        </p>
      )}
      {stage.queries.length > 0 && (
        <Group title="Searches">
          <ul className="space-y-0.5 text-xs text-fg-muted">
            {stage.queries.map((query, index) => (
              <li key={`${query.query}-${String(index)}`}>
                {query.query}{' '}
                <span className="text-fg-subtle">
                  ({query.provider},{' '}
                  {query.results === null
                    ? 'results not reported'
                    : `${String(query.results)} results`}
                  )
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}
      {stage.sources.length > 0 && (
        <Group title="Sources">
          <ul className="space-y-0.5 text-xs">
            {stage.sources.map((source) => (
              <li key={`${source.url}-${source.retrieval}`}>
                <SafeExternalLink href={source.url}>
                  {source.title || hostOf(source.url)}
                </SafeExternalLink>{' '}
                <span className="text-2xs text-fg-subtle">{source.retrieval}</span>
              </li>
            ))}
          </ul>
        </Group>
      )}
      {stage.limitations.length > 0 && (
        <Group title="Limitations">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-warning">
            {stage.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Group>
      )}
      {stage.plannedFiles.length > 0 && (
        <Group title="Files planned">
          <Paths paths={stage.plannedFiles} />
        </Group>
      )}
      {hasFiles(stage.files) && <FileChangesList files={stage.files} />}
      {stage.artifacts.length > 0 && (
        <Group title="Produced">
          <Paths paths={stage.artifacts} />
        </Group>
      )}
      {stage.checks.length > 0 && (
        <Group title="Checks run">
          <ul className="space-y-1 text-xs text-fg-muted">
            {stage.checks.map((check) => (
              <li key={check.seq}>
                <span
                  className={cn(
                    'font-mono text-2xs',
                    check.status === 'failed'
                      ? 'text-danger'
                      : check.status === 'succeeded'
                        ? 'text-success'
                        : 'text-fg-subtle',
                  )}
                >
                  {check.status === 'succeeded' ? 'passed' : check.status}
                </span>{' '}
                {check.id}: {check.summary}
                {check.exitCode !== null && (
                  <span className="text-fg-subtle"> (exit {check.exitCode})</span>
                )}
                {check.durationMs !== null && (
                  <span className="text-fg-subtle"> in {formatDuration(check.durationMs)}</span>
                )}
                {check.command && (
                  <code className="mt-0.5 block font-mono text-2xs break-all text-fg-subtle">
                    {check.command}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </Group>
      )}
      {stage.verifyOutcome && (
        <Group title="Verification result">
          <p className={cn('text-xs', stage.verifyOutcome.ok ? 'text-success' : 'text-danger')}>
            {stage.verifyOutcome.ok
              ? 'Every check that ran passed.'
              : `Failed: ${stage.verifyOutcome.failed.join(', ') || 'see checks above'}`}
          </p>
          {stage.verifyOutcome.limitations.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-warning">
              {stage.verifyOutcome.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Group>
      )}
      {stage.repairs.length > 0 && (
        <Group title="Repair attempts">
          <ul className="space-y-0.5 text-xs text-fg-muted">
            {stage.repairs.map((repair) => (
              <li key={repair.seq}>
                Attempt {repair.attempt}
                {repair.maxAttempts === null ? '' : ` of ${String(repair.maxAttempts)}`}
                {repair.targets.length > 0 ? `: ${repair.targets.join(', ')}` : ''}
              </li>
            ))}
          </ul>
          {stage.repairOutcome && (
            <p
              className={cn(
                'mt-1 text-xs',
                stage.repairOutcome.repaired ? 'text-success' : 'text-danger',
              )}
            >
              {stage.repairOutcome.repaired
                ? 'Repaired, confirmed by re-running verification.'
                : 'Not repaired.'}
            </p>
          )}
        </Group>
      )}
      {stage.models.length > 0 && (
        <Group title="Model calls">
          <ul className="space-y-0.5 text-xs text-fg-muted">
            {stage.models.map((call) => (
              <li key={call.seq}>
                <span className="break-all">
                  {call.provider}/{call.model}
                </span>
                {call.ok ? '' : ', failed'}
                {call.fallback ? ', fallback' : ''}
                {call.fromPlanning ? ', from planning' : ''}
                {call.durationMs === null ? '' : `, ${formatDuration(call.durationMs)}`}
                {call.error && (
                  <span className="block text-2xs break-words text-danger">{call.error}</span>
                )}
              </li>
            ))}
          </ul>
        </Group>
      )}
      <Group title="Usage">
        <p className="text-xs text-fg-muted">
          {stage.usage === null && stage.models.length === 0
            ? 'No model call recorded for this stage.'
            : `Tokens: ${usage.tokens}. Cost: ${usage.cost}.`}
        </p>
      </Group>
      {stage.log.length > 0 && (
        <Group title="Recorded events">
          <ol className="space-y-0.5 text-xs text-fg-muted">
            {stage.log.map((line) => (
              <li key={line.seq} className="flex gap-2">
                <time dateTime={line.at} className="shrink-0 font-mono text-2xs text-fg-subtle">
                  {formatClock(line.at)}
                </time>
                <span className="min-w-0 break-words">{line.message}</span>
              </li>
            ))}
          </ol>
        </Group>
      )}
    </div>
  );
}

export function ExecutionStage({ stage }: { stage: StageView }) {
  const status = STATUS[stage.status];
  const expandable = stage.status !== 'pending';
  const header = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span aria-hidden="true" className="shrink-0">
        {status.icon}
      </span>
      <span className="min-w-0 text-xs font-medium text-fg">{stage.label}</span>
      <Badge variant={status.variant}>{status.label}</Badge>
      {stage.degraded && <Badge variant="warning">Degraded</Badge>}
      {stage.agentId && <span className="font-mono text-2xs text-fg-subtle">{stage.agentId}</span>}
      <span className="ml-auto font-mono text-2xs text-fg-subtle">
        {stage.status === 'running' && stage.startedAt
          ? `since ${formatClock(stage.startedAt)}`
          : stage.durationMs === null
            ? ''
            : formatDuration(stage.durationMs)}
      </span>
    </div>
  );
  return (
    <li className="rounded-md border border-line bg-surface px-3 py-2">
      {expandable ? (
        <details>
          <summary className="flex cursor-pointer items-center gap-2">{header}</summary>
          {stage.responsibility && (
            <p className="mt-2 text-xs text-fg-muted">{stage.responsibility}</p>
          )}
          {stage.summary && (
            <p className="mt-1 text-xs break-words text-fg-muted">{stage.summary}</p>
          )}
          <Details stage={stage} />
        </details>
      ) : (
        <div>
          <div className="flex items-center gap-2">{header}</div>
          {stage.responsibility && (
            <p className="mt-1 text-xs text-fg-subtle">{stage.responsibility}</p>
          )}
        </div>
      )}
    </li>
  );
}
