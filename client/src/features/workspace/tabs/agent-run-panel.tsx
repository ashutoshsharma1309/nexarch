/**
 * The planning mesh, as much of it as is worth showing.
 *
 * Eight agents run here: five that plan, two that generate, and one that
 * reviews what was generated. Each row answers the questions someone
 * watching a run actually has — which agent, what state, how long — and
 * expands to the ones they ask next: what it was given, what it produced,
 * what it cost, and what it found.
 *
 * The detail is behind a click rather than always shown because eight
 * agents' worth of findings and token counts, all open at once, is a wall
 * of text nobody reads. Everything else the orchestrator tracks — waves,
 * events, artifact plumbing — stays internal until there is a screen that
 * needs it.
 *
 * Every status here is the server's. There is no percentage and no
 * animation standing in for progress: a task is pending, running, done,
 * failed or blocked, and the row says which.
 */
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  CircleDashed,
  Cpu,
  Minus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { Spinner } from '@/shared/components/ui/spinner';
import {
  useAgentCatalogue,
  useAgentRun,
  useCancelAgentRun,
  useResumeAgentRun,
  useStartAgentRun,
} from '@/shared/hooks/use-agent-run';
import { cn } from '@/shared/lib/cn';
import { toast } from '@/shared/store/toast.store';
import type { AgentFinding, AgentTask, AgentTaskStatus } from '@/shared/types/api';

function TaskIcon({ status }: { status: AgentTaskStatus }) {
  switch (status) {
    case 'COMPLETED':
      return <Check className="size-3.5 text-success" />;
    case 'RUNNING':
      return <Spinner className="size-3.5" />;
    case 'FAILED':
      return <AlertTriangle className="size-3.5 text-danger" />;
    case 'BLOCKED':
      return <Ban className="size-3.5 text-warning" />;
    case 'CANCELLED':
      return <Minus className="size-3.5 text-fg-subtle" />;
    default:
      return <CircleDashed className="size-3.5 text-fg-subtle" />;
  }
}

function duration(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const SEVERITY_TONE: Record<AgentFinding['severity'], string> = {
  CRITICAL: 'text-danger',
  HIGH: 'text-danger',
  MEDIUM: 'text-warning',
  LOW: 'text-fg-muted',
  INFO: 'text-fg-subtle',
};

/**
 * The expanded half of a row.
 *
 * Findings are listed rather than counted because a count is not
 * actionable: "3 findings" tells a reader there is something to look at
 * without telling them whether it matters. They are ordered by severity so
 * the one that blocks a user is not below three cosmetic notes.
 */
function TaskDetail({ task, produces }: { task: AgentTask; produces: string[] }) {
  const order: AgentFinding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  const findings = [...task.findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );

  return (
    <div className="mt-2 space-y-2 border-l border-line pl-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-2xs text-fg-subtle">
        <dt>status</dt>
        <dd className="text-fg-muted">{task.status.toLowerCase()}</dd>
        <dt>duration</dt>
        <dd className="text-fg-muted tabular-nums">{duration(task.durationMs) ?? '—'}</dd>
        <dt>needs</dt>
        <dd className="text-fg-muted">{task.inputArtifactTypes.join(', ') || 'nothing'}</dd>
        <dt>produced</dt>
        <dd className="text-fg-muted">
          {task.status === 'COMPLETED' ? produces.join(', ') || '—' : '—'}
        </dd>
        {task.usage && (
          <>
            <dt>context</dt>
            <dd className="text-fg-muted tabular-nums">
              {task.usage.contextTokens} tokens selected from the graph
            </dd>
            <dt>model</dt>
            <dd className="text-fg-muted">
              {task.usage.model} · {task.usage.inputTokens} in / {task.usage.outputTokens} out · $
              {task.usage.costUsd.toFixed(4)}
            </dd>
          </>
        )}
      </dl>

      {findings.length > 0 && (
        <ul className="space-y-1">
          {findings.map((finding, index) => (
            <li key={`${finding.category}-${String(index)}`} className="text-2xs">
              <span className={cn('font-mono', SEVERITY_TONE[finding.severity])}>
                {finding.severity}
              </span>{' '}
              <span className="text-fg-muted">{finding.title}</span>
              <p className="text-fg-subtle">{finding.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({
  task,
  name,
  mode,
  produces,
}: {
  task: AgentTask;
  name: string;
  mode: string;
  produces: string[];
}) {
  const [open, setOpen] = useState(false);
  // Nothing to expand before an agent has run: an empty panel invites a
  // click that answers nothing.
  const expandable = task.usage !== null || task.findings.length > 0 || task.durationMs !== null;

  return (
    <li
      data-agent={task.agentId}
      data-status={task.status}
      className={cn('px-4 py-2.5', task.status === 'RUNNING' && 'bg-raised/40')}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <TaskIcon status={task.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {expandable ? (
              <button
                type="button"
                onClick={() => {
                  setOpen((value) => !value);
                }}
                aria-expanded={open}
                className="-ml-1 flex items-center gap-1 rounded px-1 text-[0.8125rem] font-medium text-fg hover:bg-raised"
              >
                <ChevronRight
                  className={cn('size-3 text-fg-subtle transition-transform', open && 'rotate-90')}
                />
                {name}
              </button>
            ) : (
              <p
                className={cn(
                  'text-[0.8125rem] font-medium',
                  ['PENDING', 'READY', 'CANCELLED'].includes(task.status)
                    ? 'text-fg-subtle'
                    : 'text-fg',
                )}
              >
                {name}
              </p>
            )}
            {mode === 'ai' && (
              <Badge variant="ember">
                <span className="flex items-center gap-1">
                  <Sparkles className="size-2.5" /> AI
                </span>
              </Badge>
            )}
            {task.retryCount > 0 && <Badge variant="warning">{task.retryCount} retries</Badge>}
            {task.findings.length > 0 && (
              <Badge
                variant={task.findings.some((f) => f.severity === 'HIGH') ? 'warning' : 'neutral'}
              >
                {task.findings.length} finding{task.findings.length === 1 ? '' : 's'}
              </Badge>
            )}
            {duration(task.durationMs) && (
              <span className="font-mono text-2xs text-fg-subtle tabular-nums">
                {duration(task.durationMs)}
              </span>
            )}
          </div>
          {task.summary && <p className="mt-0.5 text-xs text-fg-muted">{task.summary}</p>}
          {/*
            Context size and tokens are per-agent, not per-run: the point of
            the Context Engine is that one agent gets 185 tokens where a naive
            prompt would have sent the whole project, and a run-level total
            hides exactly that.
          */}
          {task.usage !== null && !open && (
            <p className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-2xs text-fg-subtle tabular-nums">
              <span>{task.usage.contextTokens} ctx</span>
              <span>
                {task.usage.inputTokens}↓ {task.usage.outputTokens}↑
              </span>
              {task.usage.costUsd > 0 && <span>${task.usage.costUsd.toFixed(4)}</span>}
            </p>
          )}
          {task.error && <p className="mt-0.5 text-xs text-danger">{task.error}</p>}
          {task.status === 'BLOCKED' && !task.error && (
            <p className="mt-0.5 text-xs text-warning">
              Blocked — an upstream agent did not finish
            </p>
          )}
          {open && <TaskDetail task={task} produces={produces} />}
        </div>
      </div>
    </li>
  );
}

export function AgentRunPanel({ projectId, prompt }: { projectId: string; prompt: string }) {
  const [runId, setRunId] = useState<string | null>(null);
  const catalogue = useAgentCatalogue(projectId);
  const run = useAgentRun(projectId, runId);
  const start = useStartAgentRun(projectId);
  const cancel = useCancelAgentRun(projectId);
  const resume = useResumeAgentRun(projectId);

  const nameOf = (agentId: string): string =>
    catalogue.data?.find((entry) => entry.id === agentId)?.name ?? agentId;
  const modeOf = (agentId: string): string =>
    catalogue.data?.find((entry) => entry.id === agentId)?.executionMode ?? 'deterministic';
  const producesOf = (agentId: string): string[] =>
    catalogue.data?.find((entry) => entry.id === agentId)?.produces ?? [];

  const view = run.data;
  const live = view?.run.status === 'RUNNING' || view?.run.status === 'PENDING';
  const canResume = view?.run.status === 'FAILED' || view?.run.status === 'CANCELLED';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="flex items-center gap-1.5 font-mono text-xs text-fg-subtle">
          <Cpu className="size-3.5" />
          agent runtime
          <Badge variant="neutral">preview</Badge>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {view && (
            <span className="font-mono text-2xs text-fg-subtle tabular-nums">
              {view.progress.completed}/{view.progress.total} done
              {view.progress.failed > 0 && ` · ${String(view.progress.failed)} failed`}
            </span>
          )}
          {live && (
            <Button
              size="sm"
              onClick={() => {
                if (runId) cancel.mutate(runId);
              }}
            >
              Cancel
            </Button>
          )}
          {canResume && runId && (
            <Button
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              loading={resume.isPending}
              onClick={() => {
                resume.mutate(runId, {
                  onError: (error) => {
                    toast(error instanceof Error ? error.message : 'Resume failed', 'error');
                  },
                });
              }}
            >
              Resume
            </Button>
          )}
          {!live && (
            <Button
              size="sm"
              variant="secondary"
              loading={start.isPending}
              disabled={prompt.trim().length < 20}
              title={prompt.trim().length < 20 ? 'Describe the project first' : undefined}
              onClick={() => {
                start.mutate(prompt, {
                  onSuccess: (created) => {
                    setRunId(created.run.id);
                  },
                  onError: (error) => {
                    toast(
                      error instanceof Error ? error.message : 'Could not start the agent run',
                      'error',
                    );
                  },
                });
              }}
            >
              {runId ? 'Run again' : 'Run agents'}
            </Button>
          )}
        </div>
      </div>

      {!view ? (
        <CardContent className="py-4">
          <p className="text-xs text-fg-muted">
            Eight agents turn a prompt into a reviewed application. Five plan it: the requirement
            analyst reads the prompt, the product architect decides what the product contains, and
            the architecture, database and API architects turn that into a technical design. Two
            build it, backend before frontend so the interface is written against endpoints that
            exist. The last one reviews what was built and fixes what it can. The legacy pipeline
            above is unchanged and remains the default path.
          </p>
        </CardContent>
      ) : (
        <>
          <ul className="divide-y divide-line" aria-label="Agent tasks">
            {view.run.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                name={nameOf(task.agentId)}
                mode={modeOf(task.agentId)}
                produces={producesOf(task.agentId)}
              />
            ))}
          </ul>
          {view.run.totals.aiCalls > 0 && (
            <div className="border-t border-line px-4 py-2">
              <p className="font-mono text-2xs text-fg-subtle">
                {view.run.totals.aiCalls} model call
                {view.run.totals.aiCalls === 1 ? '' : 's'} ·{' '}
                {view.run.totals.inputTokens + view.run.totals.outputTokens} tokens · $
                {view.run.totals.costUsd.toFixed(4)}
                {view.run.totals.contextTokens > 0 &&
                  ` · ${String(view.run.totals.contextTokens)} context`}
              </p>
            </div>
          )}
          {view.run.error && (
            <div className="border-t border-line px-4 py-2">
              <p className="text-xs text-danger">{view.run.error}</p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
