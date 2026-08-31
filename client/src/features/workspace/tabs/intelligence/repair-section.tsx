/**
 * Self-Repair — what NexArch changed, and why.
 *
 * The page answers the question that makes autonomous repair trustworthy
 * or not: every repair opens into its finding, root cause, plan, the
 * exact diff, the validation that ran, and whether it was rolled back.
 * The diff is hunks, not whole files, and a REQUIRES_REVIEW entry shows
 * *why* the machine kept its hands off — Step 25's contract with the user.
 */
import { Check, ChevronRight, CircleDashed, RotateCcw, Undo2, Wrench, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Spinner } from '@/shared/components/ui/spinner';
import { useRepairs, useStartRepairs } from '@/shared/hooks/use-engineering-review';
import { cn } from '@/shared/lib/cn';
import { toast } from '@/shared/store/toast.store';
import { useWorkspace } from '../../workspace-context';
import type { RepairFileChange, RepairRecordView } from '@/shared/types/api';

const RESULT_TONE: Record<string, string> = {
  FIXED: 'text-success',
  REJECTED: 'text-danger',
  REGRESSION: 'text-danger',
  REPAIR_LOOP: 'text-warning',
  REQUIRES_REVIEW: 'text-warning',
  NOT_REPAIRABLE: 'text-fg-subtle',
  SKIPPED: 'text-fg-subtle',
};

function ResultIcon({ result }: { result: string }) {
  if (result === 'FIXED') return <Check className="size-3.5 text-success" />;
  if (result === 'REJECTED' || result === 'REGRESSION')
    return <X className="size-3.5 text-danger" />;
  if (result === 'REPAIR_LOOP') return <RotateCcw className="size-3.5 text-warning" />;
  return <CircleDashed className="size-3.5 text-fg-subtle" />;
}

/** A readable hunk diff — removed lines, then added, never whole files. */
function Diff({ change }: { change: RepairFileChange }) {
  return (
    <div className="overflow-x-auto rounded border border-line bg-raised/40">
      <p className="border-b border-line px-2 py-1 font-mono text-2xs text-fg-subtle">
        {change.file} <span className="text-success">+{change.addedLines}</span>{' '}
        <span className="text-danger">−{change.removedLines}</span> · v{change.previousVersion} → v
        {change.newVersion}
      </p>
      <pre className="p-2 text-2xs leading-relaxed">
        {change.hunks.map((hunk, index) => (
          <span key={`${String(hunk.line)}-${String(index)}`}>
            <span className="text-fg-subtle">
              @@ line {hunk.line} @@{'\n'}
            </span>
            {hunk.removed.map((line, i) => (
              <span key={`r${String(i)}`} className="text-danger">
                − {line}
                {'\n'}
              </span>
            ))}
            {hunk.added.map((line, i) => (
              <span key={`a${String(i)}`} className="text-success">
                + {line}
                {'\n'}
              </span>
            ))}
          </span>
        ))}
      </pre>
    </div>
  );
}

function RepairRow({ repair }: { repair: RepairRecordView }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-2.5" data-repair={repair.id} data-result={repair.result}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="-mx-1 flex w-full items-start gap-2 rounded px-1 text-left hover:bg-raised"
      >
        <ChevronRight
          className={cn(
            'mt-0.5 size-3 shrink-0 text-fg-subtle transition-transform',
            open && 'rotate-90',
          )}
        />
        <ResultIcon result={repair.result} />
        <span className="min-w-0 flex-1 text-xs text-fg">{repair.findingTitle}</span>
        <span className={cn('font-mono text-2xs', RESULT_TONE[repair.result] ?? 'text-fg-muted')}>
          {repair.result.replace(/_/g, ' ').toLowerCase()}
        </span>
        {repair.rolledBack && (
          <Badge variant="warning">
            <span className="flex items-center gap-1">
              <Undo2 className="size-2.5" /> rolled back
            </span>
          </Badge>
        )}
      </button>

      {open && (
        <div className="mt-2 ml-5 space-y-2 border-l border-line pl-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-2xs text-fg-subtle">
            <dt>eligibility</dt>
            <dd className="text-fg-muted">
              {repair.eligibility.eligibility} — {repair.eligibility.reason}
            </dd>
            {repair.rootCause && (
              <>
                <dt>root cause</dt>
                <dd className="text-fg-muted">
                  {repair.rootCause.rootCause} ({Math.round(repair.rootCause.confidence * 100)}%
                  confidence)
                </dd>
              </>
            )}
            {repair.plan && (
              <>
                <dt>plan</dt>
                <dd className="text-fg-muted">
                  {repair.plan.strategy} · may touch: {repair.plan.authorizedFiles.join(', ')} ·
                  validated by: {repair.plan.validation.join(', ')}
                </dd>
              </>
            )}
            {repair.attempts.length > 0 && (
              <>
                <dt>attempts</dt>
                <dd className="text-fg-muted">
                  {repair.attempts
                    .map(
                      (attempt) =>
                        `#${String(attempt.attempt)} ${attempt.strategy} → ${attempt.outcome.toLowerCase()}${
                          attempt.checks.length > 0
                            ? ` (${attempt.checks.map((check) => `${check.kind} ${check.status}`).join(', ')})`
                            : ''
                        }`,
                    )
                    .join(' · ')}
                </dd>
              </>
            )}
            {(repair.tokens.input > 0 || repair.tokens.output > 0) && (
              <>
                <dt>tokens</dt>
                <dd className="text-fg-muted tabular-nums">
                  {repair.tokens.input}↓ {repair.tokens.output}↑
                </dd>
              </>
            )}
          </dl>

          {repair.changeset?.files.map((change) => (
            <Diff key={change.file} change={change} />
          ))}

          {repair.attempts.some((attempt) => attempt.error) && (
            <p className="text-2xs text-danger">
              {repair.attempts.find((attempt) => attempt.error)?.error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function RepairSection() {
  const workspace = useWorkspace();
  const projectId = workspace.project?.id;
  const repairs = useRepairs(projectId);
  const start = useStartRepairs(projectId);

  if (repairs.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-fg-muted">
        <Spinner className="size-3.5" /> Loading repairs…
      </div>
    );
  }

  const session = repairs.data?.session ?? null;
  const records = repairs.data?.repairs ?? [];
  const running = session?.status === 'RUNNING';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="flex items-center gap-1.5 font-mono text-xs text-fg-subtle">
              <Wrench className="size-3.5" /> self-repair
            </p>
            {session ? (
              <>
                <p className="mt-0.5 text-sm text-fg">
                  {running ? 'Repairing…' : session.finalState.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-fg-muted">{session.stopReason || 'In progress.'}</p>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-fg-muted">
                No repair session yet. Repairs run over the open findings from the last validation.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={running || start.isPending}
            onClick={() => {
              start.mutate(undefined, {
                onError: (error) => {
                  toast(
                    error instanceof Error ? error.message : 'Could not start repairs',
                    'error',
                  );
                },
              });
            }}
            className="rounded border border-line px-3 py-1.5 text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run repairs'}
          </button>
        </CardContent>
        {session && (
          <p className="border-t border-line px-4 py-2 font-mono text-2xs text-fg-subtle tabular-nums">
            {session.counts.considered} findings · {session.counts.autoRepairable} repairable ·{' '}
            {session.counts.fixed} fixed · {session.counts.requiresReview} need review ·{' '}
            {session.counts.notRepairable} not repairable · {session.counts.rolledBack} rolled back
            {session.counts.repairLoops > 0 && ` · ${String(session.counts.repairLoops)} loops`}
          </p>
        )}
      </Card>

      {records.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line" aria-label="Repairs">
            {records.map((repair) => (
              <RepairRow key={repair.id} repair={repair} />
            ))}
          </ul>
        </Card>
      ) : (
        !session && (
          <EmptyState
            icon={<Wrench className="size-4" />}
            title="Nothing repaired yet"
            description="Run a validation to produce findings, then run repairs. Every change will be listed here with its diff and its evidence."
          />
        )
      )}
    </div>
  );
}
