/**
 * Project Intelligence — the whole project's state, on one screen.
 *
 * Every number here comes from one aggregation request against systems
 * that already exist: health from the validation gate and the finding
 * store, activity from the agent run, repairs from the repair engine,
 * tokens from the run's own accounting. Where a subsystem has never run,
 * the screen says NOT RUN — silence is rendered as silence, never as a
 * plausible zero.
 *
 * Status is never communicated by color alone (Step 31): every indicator
 * pairs its color with a text label and an aria-label, so the screen reads
 * the same to a screen reader as it looks to an eye.
 */
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDashed,
  Clock,
  Coins,
  GitCompareArrows,
  MonitorPlay,
  Network,
  Play,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Spinner } from '@/shared/components/ui/spinner';
import { useProjectIntelligence } from '@/shared/hooks/use-engineering-review';
import { cn } from '@/shared/lib/cn';
import { useWorkspace } from '../workspace-context';
import type {
  HealthEntry,
  HealthState,
  ProjectIntelligenceView,
  RunHistoryEntry,
} from '@/shared/types/api';

/* ── Status vocabulary ─────────────────────────────────────────────────── */

const STATUS_TONE: Record<ProjectIntelligenceView['status'], string> = {
  HEALTHY: 'border-success/40 text-success',
  HEALTHY_WITH_WARNINGS: 'border-warning/40 text-warning',
  REQUIRES_REVIEW: 'border-warning/40 text-warning',
  FAILED: 'border-danger/40 text-danger',
  BUILDING: 'border-ember text-fg',
  REVIEWING: 'border-ember text-fg',
  VALIDATING: 'border-ember text-fg',
  REPAIRING: 'border-ember text-fg',
  NOT_RUN: 'border-line text-fg-subtle',
};

const HEALTH_TONE: Record<HealthState, string> = {
  HEALTHY: 'text-success',
  WARNING: 'text-warning',
  FAILED: 'text-danger',
  BLOCKED: 'text-warning',
  NOT_RUN: 'text-fg-subtle',
};

function HealthIcon({ state }: { state: HealthState }) {
  if (state === 'HEALTHY') return <Check className="size-3.5 text-success" aria-hidden />;
  if (state === 'FAILED') return <X className="size-3.5 text-danger" aria-hidden />;
  if (state === 'WARNING' || state === 'BLOCKED')
    return <AlertTriangle className="size-3.5 text-warning" aria-hidden />;
  return <CircleDashed className="size-3.5 text-fg-subtle" aria-hidden />;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/* ── Sections ──────────────────────────────────────────────────────────── */

function HealthGrid({ health }: { health: HealthEntry[] }) {
  return (
    <section aria-label="Project health">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {health.map((entry) => (
          <div
            key={entry.category}
            className="rounded-md border border-line p-2.5"
            aria-label={`${entry.category}: ${entry.state}. ${entry.detail}`}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
              <HealthIcon state={entry.state} />
              {entry.category}
            </p>
            <p className={cn('mt-0.5 font-mono text-2xs', HEALTH_TONE[entry.state])}>
              {entry.state.replace('_', ' ')}
            </p>
            <p className="mt-0.5 truncate text-2xs text-fg-subtle" title={entry.detail}>
              {entry.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricsStrip({ metrics }: { metrics: ProjectIntelligenceView['metrics'] }) {
  const items: { label: string; value: string }[] = [
    { label: 'graph nodes', value: metrics.graphNodes === null ? '—' : String(metrics.graphNodes) },
    { label: 'edges', value: metrics.graphEdges === null ? '—' : String(metrics.graphEdges) },
    { label: 'services', value: String(metrics.services) },
    { label: 'APIs', value: String(metrics.apis) },
    { label: 'entities', value: String(metrics.entities) },
    { label: 'files', value: String(metrics.files) },
    { label: 'agents run', value: String(metrics.agentsExecuted) },
    { label: 'findings', value: String(metrics.findings) },
    {
      label: 'tests',
      value:
        metrics.testsTotal > 0
          ? `${String(metrics.testsPassed)}/${String(metrics.testsTotal)}`
          : '—',
    },
    { label: 'repairs', value: String(metrics.repairsFixed) },
  ];
  return (
    <section aria-label="Engineering metrics">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-md border border-line px-3 py-2">
        {items.map((item) => (
          <p key={item.label} className="font-mono text-2xs text-fg-subtle tabular-nums">
            <span className="text-fg">{item.value}</span> {item.label}
          </p>
        ))}
      </div>
    </section>
  );
}

function AgentActivity({ agents }: { agents: NonNullable<ProjectIntelligenceView['agents']> }) {
  return (
    <Card>
      <p className="border-b border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
        agent activity · latest run
      </p>
      <ul className="divide-y divide-line" aria-label="Agent activity">
        {agents.map((agent) => (
          <li key={agent.agentId} className="flex items-start gap-2 px-4 py-1.5">
            <span className="mt-0.5">
              <HealthIcon
                state={
                  agent.status === 'COMPLETED'
                    ? 'HEALTHY'
                    : agent.status === 'FAILED'
                      ? 'FAILED'
                      : agent.status === 'RUNNING'
                        ? 'WARNING'
                        : 'NOT_RUN'
                }
              />
            </span>
            <span className="w-40 shrink-0 truncate text-xs text-fg">{agent.name}</span>
            <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
              {agent.summary ?? agent.status.toLowerCase()}
            </span>
            <span className="font-mono text-2xs text-fg-subtle tabular-nums">
              {duration(agent.durationMs)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Timeline({ timeline }: { timeline: ProjectIntelligenceView['timeline'] }) {
  if (timeline.length === 0) return null;
  return (
    <Card>
      <p className="flex items-center gap-1.5 border-b border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
        <Clock className="size-3" aria-hidden /> timeline
      </p>
      <ol className="divide-y divide-line" aria-label="Engineering timeline">
        {timeline.map((event) => (
          <li key={`${event.at}-${event.label}`} className="flex items-baseline gap-3 px-4 py-1.5">
            <time
              dateTime={event.at}
              className="shrink-0 font-mono text-2xs text-fg-subtle tabular-nums"
            >
              {new Date(event.at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </time>
            <span className="text-xs text-fg">{event.label}</span>
            {event.detail && (
              <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                {event.detail}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function SummaryCard({
  title,
  icon: Icon,
  to,
  children,
}: {
  title: string;
  icon: typeof Activity;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <Link
        to={to}
        className="flex items-center justify-between border-b border-line px-4 py-2 hover:bg-raised"
      >
        <span className="flex items-center gap-1.5 font-mono text-2xs text-fg-subtle">
          <Icon className="size-3" aria-hidden /> {title}
        </span>
        <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
      </Link>
      <CardContent className="py-2.5">{children}</CardContent>
    </Card>
  );
}

/* ── Run history and comparison (Steps 16–17) ──────────────────────────── */

function RunHistory({ runs }: { runs: RunHistoryEntry[] }) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (runId: string): void => {
    setSelected((current) =>
      current.includes(runId)
        ? current.filter((id) => id !== runId)
        : [...current.slice(-1), runId],
    );
  };

  const [a, b] = selected.map((id) => runs.find((run) => run.runId === id)).filter(Boolean) as [
    RunHistoryEntry?,
    RunHistoryEntry?,
  ];

  const compare = (
    label: string,
    of: (run: RunHistoryEntry) => string,
  ): { label: string; from: string; to: string } | null => {
    if (!a || !b) return null;
    return { label, from: of(a), to: of(b) };
  };

  const rows = [
    compare('Findings', (run) => (run.findings === null ? '—' : String(run.findings))),
    compare('Review score', (run) =>
      run.reviewScore === null ? '—' : `${String(run.reviewScore)}/100`,
    ),
    compare('Gate', (run) => run.gate ?? '—'),
    compare('Tests', (run) =>
      run.testsTotal === null ? '—' : `${String(run.testsPassed ?? 0)}/${String(run.testsTotal)}`,
    ),
    compare('Tokens', (run) =>
      run.tokens ? String(run.tokens.input + run.tokens.output) : 'not available',
    ),
    compare('Agents', (run) =>
      run.agentsTotal === null
        ? '—'
        : `${String(run.agentsCompleted ?? 0)}/${String(run.agentsTotal)}`,
    ),
  ].filter(Boolean) as { label: string; from: string; to: string }[];

  return (
    <section aria-label="Run history">
      <Card>
        <p className="border-b border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
          run history · select two to compare
        </p>
        <ul className="divide-y divide-line">
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                type="button"
                onClick={() => {
                  toggle(run.runId);
                }}
                aria-pressed={selected.includes(run.runId)}
                className={cn(
                  'flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-left hover:bg-raised',
                  selected.includes(run.runId) && 'bg-raised',
                )}
              >
                <span className="font-mono text-2xs text-fg">{run.runId.slice(0, 8)}</span>
                <span className="font-mono text-2xs text-fg-subtle tabular-nums">
                  {run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
                </span>
                <Badge
                  variant={
                    run.status === 'COMPLETED'
                      ? 'neutral'
                      : run.status === 'SETTLED'
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {run.status.toLowerCase()}
                </Badge>
                {run.gate && (
                  <span
                    className={cn(
                      'font-mono text-2xs',
                      run.gate === 'PASSED'
                        ? 'text-success'
                        : run.gate === 'FAILED'
                          ? 'text-danger'
                          : 'text-warning',
                    )}
                  >
                    {run.gate.replace(/_/g, ' ').toLowerCase()}
                  </span>
                )}
                {run.testsTotal !== null && (
                  <span className="font-mono text-2xs text-fg-subtle tabular-nums">
                    tests {run.testsPassed}/{run.testsTotal}
                  </span>
                )}
                {run.findings !== null && (
                  <span className="font-mono text-2xs text-fg-subtle tabular-nums">
                    {run.findings} findings
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {a && b && (
          <div className="border-t border-line px-4 py-2.5" aria-label="Run comparison">
            <p className="flex items-center gap-1.5 font-mono text-2xs text-fg-subtle">
              <GitCompareArrows className="size-3" aria-hidden />
              {a.runId.slice(0, 8)} → {b.runId.slice(0, 8)}
            </p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-2xs text-fg-subtle">{row.label}</dt>
                  <dd
                    className={cn(
                      'font-mono text-2xs tabular-nums',
                      row.from === row.to ? 'text-fg-muted' : 'text-fg',
                    )}
                  >
                    {row.from} → {row.to}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Card>
    </section>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

export function OverviewTab() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const projectId = workspace.project?.id;
  const base = `/projects/${projectId ?? ''}`;
  const intelligence = useProjectIntelligence(projectId);

  if (intelligence.isPending) {
    return (
      <div className="flex items-center gap-2 py-10 text-xs text-fg-muted">
        <Spinner className="size-3.5" /> Loading project intelligence…
      </div>
    );
  }

  /* Localized failure (Step 21): the tab reports itself; the rest of the
     workspace — code, graph, preview — keeps working from its own data. */
  if (intelligence.isError) {
    return (
      <Card className="border-danger/40">
        <CardContent className="py-4">
          <p className="text-xs text-fg">The intelligence summary is unavailable.</p>
          <p className="mt-0.5 text-2xs text-fg-subtle">
            Other tabs still work.{' '}
            {intelligence.error instanceof Error ? intelligence.error.message : ''}
          </p>
          <button
            type="button"
            onClick={() => void intelligence.refetch()}
            className="mt-2 rounded border border-line px-2.5 py-1 text-2xs text-fg-muted hover:border-line-strong hover:text-fg"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const view = intelligence.data;
  const live = ['BUILDING', 'REVIEWING', 'VALIDATING', 'REPAIRING'].includes(view.status);

  /* Quick actions, only where the state supports them (Step 26). */
  const actions: { label: string; icon: typeof Play; to: string }[] = [
    { label: live ? 'View run' : 'Run agents', icon: Play, to: `${base}/build` },
  ];
  if (view.metrics.files > 0)
    actions.push({ label: 'Open preview', icon: MonitorPlay, to: `${base}/preview` });
  if (view.metrics.graphNodes)
    actions.push({ label: 'Open graph', icon: Network, to: `${base}/intelligence/graph` });
  if (view.findings)
    actions.push({ label: 'View findings', icon: ShieldAlert, to: `${base}/intelligence` });
  if (view.validation)
    actions.push({
      label: 'View validation',
      icon: Activity,
      to: `${base}/intelligence/validation`,
    });
  if (view.repairs)
    actions.push({ label: 'View repairs', icon: Wrench, to: `${base}/intelligence/repairs` });

  if (view.status === 'NOT_RUN') {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<Play className="size-4" />}
          title="Nothing has been built yet"
          description="Run the agent mesh from the Build tab. Planning, generation, review and validation will land here as they happen — with real numbers, not placeholders."
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void navigate(`${base}/build`)}
            className="rounded border border-line px-3 py-1.5 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
          >
            Go to Build
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status banner: what state, why, and what to do next. */}
      <Card>
        <CardContent
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 border-l-2 py-3',
            STATUS_TONE[view.status],
          )}
        >
          <div>
            <p className="flex items-center gap-2 font-mono text-sm font-semibold">
              {live && <Spinner className="size-3.5" />}
              {view.status.replace(/_/g, ' ')}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">{view.statusReason}</p>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Quick actions">
            {actions.map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-2xs text-fg-muted hover:border-line-strong hover:text-fg"
              >
                <action.icon className="size-3" aria-hidden /> {action.label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <HealthGrid health={view.health} />
      <MetricsStrip metrics={view.metrics} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {view.agents && <AgentActivity agents={view.agents} />}
          <Timeline timeline={view.timeline} />
        </div>

        <div className="space-y-4">
          {view.findings && (
            <SummaryCard title="findings" icon={ShieldAlert} to={`${base}/intelligence`}>
              <p className="font-mono text-2xs text-fg-muted tabular-nums">
                {view.findings.open} open · {view.findings.fixed} fixed ·{' '}
                {view.findings.requiresReview} need review
              </p>
              <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
                  .map(
                    (severity) =>
                      `${String(view.findings?.bySeverity[severity] ?? 0)} ${severity.toLowerCase()}`,
                  )
                  .join(' · ')}
              </p>
            </SummaryCard>
          )}

          {view.validation && (
            <SummaryCard title="validation" icon={Activity} to={`${base}/intelligence/validation`}>
              <ul className="space-y-0.5" aria-label="Validation rows">
                {view.validation.rows.map((row) => (
                  <li key={row.name} className="flex items-center gap-2 text-2xs">
                    <HealthIcon
                      state={
                        row.status === 'PASS'
                          ? 'HEALTHY'
                          : row.status === 'FAIL'
                            ? 'FAILED'
                            : 'BLOCKED'
                      }
                    />
                    <span className="w-20 text-fg-muted">{row.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-fg-subtle">
                      {row.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </SummaryCard>
          )}

          {view.repairs && (
            <SummaryCard title="self-repair" icon={Wrench} to={`${base}/intelligence/repairs`}>
              <p className="font-mono text-2xs text-fg-muted tabular-nums">
                {view.repairs.counts.fixed} fixed · {view.repairs.counts.requiresReview} need review
                · {view.repairs.counts.rolledBack} rolled back
                {view.repairs.counts.repairLoops > 0 &&
                  ` · ${String(view.repairs.counts.repairLoops)} loops`}
              </p>
              <p className="mt-1 truncate text-2xs text-fg-subtle">{view.repairs.stopReason}</p>
            </SummaryCard>
          )}

          {view.tokens && (
            <SummaryCard title="ai efficiency" icon={Coins} to={`${base}/build`}>
              <p className="font-mono text-2xs text-fg-muted tabular-nums">
                {view.tokens.aiCalls} AI calls · {view.tokens.inputTokens}↓{' '}
                {view.tokens.outputTokens}↑ · {view.tokens.contextTokens} context · $
                {view.tokens.costUsd.toFixed(4)}
              </p>
              {/* Cache accounting (Step 31): shown only when it did something. */}
              {view.tokens.efficiency && view.tokens.efficiency.cacheHits > 0 && (
                <p className="mt-1 font-mono text-2xs text-success tabular-nums">
                  cache: {view.tokens.efficiency.cachedAgents} agents reused ·{' '}
                  {view.tokens.efficiency.aiCallsSaved} calls + {view.tokens.efficiency.tokensSaved}{' '}
                  tokens saved
                </p>
              )}
              {view.tokens.byAgent.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {view.tokens.byAgent.slice(0, 5).map((entry) => (
                    <li
                      key={entry.agentId}
                      className="flex justify-between font-mono text-2xs text-fg-subtle tabular-nums"
                    >
                      <span>{entry.name}</span>
                      <span>{entry.tokens} tokens</span>
                    </li>
                  ))}
                </ul>
              )}
            </SummaryCard>
          )}

          {view.graphPreview && (
            <SummaryCard title="engineering graph" icon={Network} to={`${base}/intelligence/graph`}>
              <p className="font-mono text-2xs text-fg-subtle tabular-nums">
                {view.metrics.graphNodes} nodes · {view.metrics.graphEdges} edges ·{' '}
                {view.graphPreview.apis} APIs
              </p>
              {view.graphPreview.services.length > 0 && (
                <p className="mt-1 truncate text-2xs text-fg-muted">
                  <span className="text-fg-subtle">services: </span>
                  {view.graphPreview.services.join(', ')}
                </p>
              )}
              {view.graphPreview.entities.length > 0 && (
                <p className="mt-0.5 truncate text-2xs text-fg-muted">
                  <span className="text-fg-subtle">entities: </span>
                  {view.graphPreview.entities.join(', ')}
                </p>
              )}
              <p className="mt-1.5 flex items-center gap-1 text-2xs text-fg-muted">
                Open Engineering Graph <ChevronRight className="size-3" aria-hidden />
              </p>
            </SummaryCard>
          )}
        </div>
      </div>

      {view.runs.length > 0 && <RunHistory runs={view.runs} />}
    </div>
  );
}
