/**
 * Engineering Review — what the three reviewers found, and what a person
 * decides about it.
 *
 * The summary is the *stored review*, a versioned snapshot with its score
 * derivation shown in full; the findings are the *live records*, so a
 * status change is visible immediately without pretending the snapshot
 * changed. Score arithmetic is displayed rather than asserted — every
 * deduction is on screen, which is what makes the number checkable.
 *
 * Status changes are the person's half of the review loop: ACKNOWLEDGED,
 * RESOLVED and FALSE_POSITIVE exist here and nowhere in any agent. The
 * graph link appears only when a finding actually carries a node id —
 * an invented link would point at a guess.
 */
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Package,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Spinner } from '@/shared/components/ui/spinner';
import {
  useEngineeringReview,
  useProjectFindings,
  useUpdateFindingStatus,
} from '@/shared/hooks/use-engineering-review';
import { cn } from '@/shared/lib/cn';
import { useWorkspace } from '../../workspace-context';
import type { FindingRecord, FindingStatus, FindingType, ReviewSummary } from '@/shared/types/api';

const SEVERITY_TONE: Record<FindingRecord['severity'], string> = {
  CRITICAL: 'text-danger',
  HIGH: 'text-danger',
  MEDIUM: 'text-warning',
  LOW: 'text-fg-muted',
  INFO: 'text-fg-subtle',
};

const SECTION_META: Record<string, { label: string; icon: typeof ShieldAlert }> = {
  SECURITY: { label: 'Security', icon: ShieldAlert },
  DEPENDENCY: { label: 'Dependencies', icon: Package },
  CODE_QUALITY: { label: 'Code Quality', icon: SlidersHorizontal },
};

const STATUS_ACTIONS: { status: FindingStatus; label: string }[] = [
  { status: 'ACKNOWLEDGED', label: 'Acknowledge' },
  { status: 'RESOLVED', label: 'Resolved' },
  { status: 'FALSE_POSITIVE', label: 'False positive' },
];

function ScoreCard({ summary }: { summary: ReviewSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-fg-subtle">
              Engineering Review v{summary.reviewVersion}
              {summary.status !== 'COMPLETE' && (
                <Badge variant="warning" className="ml-2">
                  {summary.status.replace('_', ' ').toLowerCase()}
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-sm text-fg">
              {summary.totals.findings} finding{summary.totals.findings === 1 ? '' : 's'}
              {summary.totals.newSinceLastReview > 0 &&
                ` · ${String(summary.totals.newSinceLastReview)} new since the last review`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen((value) => !value);
            }}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-lg font-semibold text-fg tabular-nums hover:bg-raised"
          >
            {summary.score.score}
            <span className="text-xs font-normal text-fg-subtle">/100</span>
            <ChevronRight
              className={cn('size-3 text-fg-subtle transition-transform', open && 'rotate-90')}
            />
          </button>
        </div>

        {open && (
          <div className="mt-3 border-t border-line pt-3">
            {/* The arithmetic, not just the answer. */}
            <ul className="space-y-0.5 font-mono text-2xs text-fg-muted tabular-nums">
              <li>starts at 100</li>
              {summary.score.deductions.map((entry) => (
                <li key={entry.severity}>
                  − {entry.total} ({entry.count} × {entry.penaltyEach}{' '}
                  {entry.severity.toLowerCase()})
                </li>
              ))}
              <li className="text-fg">= {summary.score.score}</li>
            </ul>
            <p className="mt-2 max-w-prose text-2xs text-fg-subtle">{summary.score.basis}</p>
            {summary.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-2xs text-warning">
                {summary.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FindingRow({ finding, projectId }: { finding: FindingRecord; projectId: string }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateFindingStatus(projectId);
  const settled = finding.status !== 'OPEN';

  return (
    <li className="px-4 py-2.5" data-finding={finding.id} data-status={finding.status}>
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
            'mt-1 size-3 shrink-0 text-fg-subtle transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className={cn('mt-0.5 shrink-0 font-mono text-2xs', SEVERITY_TONE[finding.severity])}>
          {finding.severity}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 text-xs',
            settled ? 'text-fg-subtle line-through' : 'text-fg',
          )}
        >
          {finding.title}
        </span>
        {settled && (
          <Badge variant="neutral">{finding.status.replace('_', ' ').toLowerCase()}</Badge>
        )}
      </button>

      {open && (
        <div className="mt-2 ml-5 space-y-2 border-l border-line pl-3">
          <p className="max-w-prose text-xs text-fg-muted">{finding.description}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-2xs text-fg-subtle">
            <dt>category</dt>
            <dd className="text-fg-muted">{finding.category}</dd>
            {finding.evidence && (
              <>
                <dt>evidence</dt>
                <dd className="break-all text-fg-muted">{finding.evidence}</dd>
              </>
            )}
            {finding.targetFile && (
              <>
                <dt>target</dt>
                <dd className="break-all text-fg-muted">{finding.targetFile}</dd>
              </>
            )}
            <dt>agent</dt>
            <dd className="text-fg-muted">{finding.agentId}</dd>
            <dt>confidence</dt>
            <dd className="text-fg-muted tabular-nums">
              {Math.round(finding.confidence * 100)}%
              {finding.confidence < 1 && ' — judged, not measured'}
            </dd>
            <dt>seen</dt>
            <dd className="text-fg-muted tabular-nums">
              review v{finding.firstSeenReview}
              {finding.lastSeenReview !== finding.firstSeenReview &&
                ` → v${String(finding.lastSeenReview)}`}
            </dd>
          </dl>
          {finding.recommendation && (
            <p className="max-w-prose text-xs text-fg-muted">
              <span className="text-fg-subtle">Recommendation: </span>
              {finding.recommendation}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {finding.targetNodeId && (
              <Link
                to={`/projects/${projectId}/intelligence/graph?node=${finding.targetNodeId}`}
                className="rounded border border-line px-2 py-0.5 text-2xs text-fg-muted hover:border-line-strong hover:text-fg"
              >
                View in graph
              </Link>
            )}
            {STATUS_ACTIONS.filter((action) => action.status !== finding.status).map((action) => (
              <button
                key={action.status}
                type="button"
                disabled={update.isPending}
                onClick={() => {
                  update.mutate({ findingId: finding.id, status: action.status });
                }}
                className="rounded border border-line px-2 py-0.5 text-2xs text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
            {finding.status !== 'OPEN' && (
              <button
                type="button"
                disabled={update.isPending}
                onClick={() => {
                  update.mutate({ findingId: finding.id, status: 'OPEN' });
                }}
                className="rounded border border-line px-2 py-0.5 text-2xs text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50"
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function ReviewSection() {
  const workspace = useWorkspace();
  const projectId = workspace.project?.id;
  const review = useEngineeringReview(projectId);
  const findings = useProjectFindings(projectId);
  const [section, setSection] = useState<FindingType | null>(null);

  if (review.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-fg-muted">
        <Spinner className="size-3.5" /> Loading the engineering review…
      </div>
    );
  }

  if (review.isError) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-4" />}
        title="No engineering review yet"
        description="Run the agents from the Build tab — the security, dependency and code quality engineers review the generated project as its final wave."
      />
    );
  }

  const current = review.data.current;
  const summary = current.summary;
  const records = findings.data ?? current.findings;
  const visible = section ? records.filter((finding) => finding.type === section) : records;

  return (
    <div className="space-y-4">
      <ScoreCard summary={summary} />

      <div className="grid gap-3 sm:grid-cols-3">
        {summary.sections.map((entry) => {
          const meta = SECTION_META[entry.type] ?? {
            label: entry.type,
            icon: AlertTriangle,
          };
          const Icon = meta.icon;
          const active = section === entry.type;
          const clean = entry.total === 0;
          return (
            <button
              key={entry.type}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setSection(active ? null : entry.type);
              }}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                active ? 'border-ember' : 'border-line hover:border-line-strong',
              )}
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                {clean ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Icon className="size-3.5 text-fg-subtle" />
                )}
                {meta.label}
              </p>
              <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
                {clean
                  ? 'no findings'
                  : ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
                      .filter((severity) => entry.counts[severity as keyof typeof entry.counts] > 0)
                      .map(
                        (severity) =>
                          `${String(entry.counts[severity as keyof typeof entry.counts])} ${severity.toLowerCase()}`,
                      )
                      .join(' · ')}
              </p>
            </button>
          );
        })}
      </div>

      {visible.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line" aria-label="Findings">
            {visible.map((finding) => (
              <FindingRow key={finding.id} finding={finding} projectId={projectId ?? ''} />
            ))}
          </ul>
        </Card>
      ) : (
        <p className="py-4 text-center text-xs text-fg-subtle">
          {section ? 'No findings in this category.' : 'No findings.'}
        </p>
      )}
    </div>
  );
}
