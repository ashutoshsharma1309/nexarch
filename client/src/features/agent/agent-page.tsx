/**
 * The Builder Agent.
 *
 * One box for the task; everything after that is the agent's to do, and the
 * page's job is to show it doing it honestly: the plan it made, every
 * decision (and whether the model or the fallback policy made it), every
 * tool it ran with how long it took and what came back, and — once there is
 * one — the running website itself, embedded and one click from a new tab.
 *
 * Nothing here is simulated. Each row is a step the server recorded; the
 * preview is the real generated site on its own localhost port.
 */
import {
  Ban,
  Check,
  ExternalLink,
  FileCode2,
  Flag,
  FolderPlus,
  Hammer,
  Info,
  MonitorPlay,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { Spinner } from '@/shared/components/ui/spinner';
import { Textarea } from '@/shared/components/ui/textarea';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import {
  useBuilderSession,
  useBuilderSessions,
  useCancelBuilder,
  useStartBuilder,
} from '@/shared/hooks/use-builder';
import { cn } from '@/shared/lib/cn';
import { toast } from '@/shared/store/toast.store';
import type { BuilderSession, BuilderStep, BuilderToolName } from '@/shared/types/api';

const EXAMPLES: { label: string; task: string }[] = [
  {
    label: 'NovaStack landing page',
    task: 'Build a modern responsive landing page for a fictional technology company called NovaStack. Include a hero section, features, pricing, testimonials, FAQ, navigation, footer, responsive mobile layout, and polished UI.',
  },
  {
    label: 'Bakery website',
    task: 'Build a website for a neighbourhood bakery called Sweet Crumbs with its menu, online orders, customer reviews and an FAQ.',
  },
  {
    label: 'Photographer portfolio',
    task: 'Build a portfolio website for a wedding photographer called Lumen Studio with galleries, pricing packages, client testimonials and a booking form.',
  },
];

const TOOL_META: Record<
  BuilderToolName,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  create_project: { label: 'Create project', icon: FolderPlus },
  build_app: { label: 'Build application', icon: Hammer },
  review_app: { label: 'Agent review', icon: ShieldCheck },
  repair_app: { label: 'Self-repair', icon: Wrench },
  preview_app: { label: 'Start preview', icon: MonitorPlay },
  inspect_website: { label: 'Inspect website', icon: ScanSearch },
  list_files: { label: 'List files', icon: FileCode2 },
  read_file: { label: 'Read file', icon: FileCode2 },
  finish: { label: 'Finish', icon: Flag },
};

const MIN_TASK = 10;
const MAX_TASK = 4_000;

function duration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1_000) return `${String(ms)}ms`;
  const seconds = Math.round(ms / 1_000);
  return seconds < 60
    ? `${String(seconds)}s`
    : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

function statusBadge(status: BuilderSession['status']) {
  switch (status) {
    case 'running':
      return <Badge variant="accent">Running</Badge>;
    case 'succeeded':
      return <Badge variant="success">Website ready</Badge>;
    case 'failed':
      return <Badge variant="danger">Not completed</Badge>;
    case 'cancelled':
      return <Badge variant="warning">Cancelled</Badge>;
  }
}

/* ── Step details: only what helps a person judge the step ─────────────── */

interface Row {
  label: string;
  value: string;
  ok?: boolean;
}

function asRows(step: BuilderStep): Row[] {
  const detail = step.detail;
  if (!detail) return [];
  if (step.tool === 'build_app' && Array.isArray(detail.stages)) {
    return (
      detail.stages as {
        stage: string;
        status: string;
        summary: string | null;
        fallback: boolean;
      }[]
    ).map((stage) => ({
      label: stage.stage + (stage.fallback ? ' (fallback)' : ''),
      value: stage.summary ?? stage.status,
      ok: stage.status === 'completed',
    }));
  }
  if (step.tool === 'inspect_website' && Array.isArray(detail.checks)) {
    return (
      detail.checks as { check: string; ok: boolean; status?: number | null; sections?: string[] }[]
    ).map((check) => ({
      label: check.check,
      value: check.sections ? check.sections.join(', ') : String(check.status ?? '—'),
      ok: check.ok,
    }));
  }
  if (step.tool === 'review_app' && Array.isArray(detail.checks)) {
    const rows: Row[] = (detail.checks as { check: string; status: string; detail: string }[]).map(
      (check) => ({
        label: check.check,
        value: check.detail,
        ok: check.status === 'PASS',
      }),
    );
    const findings = detail.findings as Record<string, number> | undefined;
    if (findings) {
      rows.push({
        label: 'findings',
        value:
          Object.entries(findings)
            .map(([severity, count]) => `${String(count)} ${severity.toLowerCase()}`)
            .join(' · ') || 'none',
      });
    }
    return rows;
  }
  if (step.tool === 'list_files' && Array.isArray(detail.paths)) {
    return (detail.paths as string[]).slice(0, 12).map((path) => ({ label: 'file', value: path }));
  }
  return [];
}

function StepRow({ step }: { step: BuilderStep }) {
  const rows = asRows(step);

  if (step.kind === 'decision') {
    return (
      <li className="flex gap-3 py-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">{step.summary}</p>
        </div>
        <Badge variant={step.by === 'model' ? 'accent' : 'neutral'}>
          {step.by === 'model' ? 'AI' : 'Policy'}
        </Badge>
      </li>
    );
  }

  if (step.kind === 'note') {
    return (
      <li className="flex gap-3 py-2.5">
        <Info
          className={cn(
            'mt-0.5 size-4 shrink-0',
            step.status === 'failed' ? 'text-warning' : 'text-fg-subtle',
          )}
        />
        <p className="min-w-0 flex-1 text-xs text-fg-muted">{step.summary}</p>
      </li>
    );
  }

  const meta = step.tool ? TOOL_META[step.tool] : null;
  const Icon = meta?.icon ?? Hammer;
  return (
    <li className="py-2.5">
      <div className="flex gap-3">
        <span
          className={cn(
            'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border',
            step.status === 'ok' && 'border-success/30 text-success',
            step.status === 'failed' && 'border-danger/40 text-danger',
            step.status === 'running' && 'border-accent/30 text-accent',
          )}
        >
          {step.status === 'running' ? (
            <Spinner className="size-3" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium text-fg">{meta?.label ?? step.tool}</p>
            <span className="font-mono text-2xs text-fg-subtle">{duration(step.durationMs)}</span>
          </div>
          <p
            className={cn(
              'mt-0.5 text-sm break-words',
              step.status === 'failed' ? 'text-danger' : 'text-fg-muted',
            )}
          >
            {step.summary}
          </p>
          {rows.length > 0 && (
            <details className="group mt-2">
              <summary className="cursor-pointer text-xs text-fg-subtle select-none hover:text-fg-muted">
                Details
              </summary>
              <ul className="mt-2 space-y-1 rounded-md border border-line bg-inset p-2.5">
                {rows.map((row, index) => (
                  <li key={`${row.label}-${String(index)}`} className="flex gap-2 text-xs">
                    {row.ok === undefined ? (
                      <span className="size-3.5 shrink-0" />
                    ) : row.ok ? (
                      <Check className="size-3.5 shrink-0 text-success" />
                    ) : (
                      <X className="size-3.5 shrink-0 text-danger" />
                    )}
                    <span className="w-40 shrink-0 truncate font-mono text-fg-subtle">
                      {row.label}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-fg-muted">{row.value}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

/* ── Result panel ─────────────────────────────────────────────────────── */

function ResultPanel({ session }: { session: BuilderSession }) {
  const url = session.result?.frontendUrl ?? session.state.frontendUrl;
  const projectId = session.result?.projectId ?? session.state.projectId;
  const sections = session.result?.landingSections ?? session.state.landingSections;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2" aria-live="polite">
            {statusBadge(session.status)}
            <span className="font-mono text-2xs text-fg-subtle">
              {String(session.usage.modelDecisions)} AI · {String(session.usage.policyDecisions)}{' '}
              policy decisions
              {session.usage.costUsd > 0 && ` · $${session.usage.costUsd.toFixed(4)}`}
            </span>
          </div>
          {session.result && <p className="text-sm text-fg">{session.result.summary}</p>}
          {session.error && <p className="text-sm text-danger">{session.error}</p>}
          <div className="flex flex-wrap gap-2">
            {projectId && (
              <Link to={`/projects/${projectId}`}>
                <Button size="sm" variant="secondary">
                  Open project
                </Button>
              </Link>
            )}
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />}>
                  Open website
                </Button>
              </a>
            )}
            {session.state.validationGate && (
              <Badge variant={session.state.validationGate === 'FAILED' ? 'warning' : 'success'}>
                Gate {session.state.validationGate.toLowerCase().replaceAll('_', ' ')}
              </Badge>
            )}
          </div>
          {sections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sections.map((section) => (
                <Badge key={section}>{section}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="font-mono text-xs text-fg-subtle">{url ?? 'preview'}</p>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="text-fg-subtle hover:text-fg">
              <ExternalLink className="size-3.5" />
              <span className="sr-only">Open the website in a new tab</span>
            </a>
          )}
        </div>
        {url ? (
          <iframe title="Generated website" src={url} className="h-[560px] w-full bg-white" />
        ) : (
          <div className="flex h-72 flex-col items-center justify-center gap-2 px-6 text-center">
            {session.status === 'running' ? (
              <>
                <Spinner className="size-5" />
                <p className="text-sm text-fg-muted">
                  The website appears here once it is running.
                </p>
              </>
            ) : (
              <p className="text-sm text-fg-muted">No running website for this session.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function AgentPage() {
  useDocumentTitle('Builder Agent');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('session');
  const [task, setTask] = useState('');

  const sessions = useBuilderSessions();
  const current = useBuilderSession(selectedId);
  const start = useStartBuilder();
  const cancel = useCancelBuilder();

  // With nothing selected, follow the latest session.
  useEffect(() => {
    if (!selectedId && sessions.data && sessions.data.length > 0) {
      const latest = sessions.data[0];
      if (latest) setParams({ session: latest.id }, { replace: true });
    }
  }, [selectedId, sessions.data, setParams]);

  const session = current.data ?? null;
  const running = session?.status === 'running';
  const trimmed = task.trim();
  const valid = trimmed.length >= MIN_TASK && trimmed.length <= MAX_TASK;

  const submit = () => {
    if (!valid) return;
    start.mutate(trimmed, {
      onSuccess: (created) => {
        setParams({ session: created.id });
        toast('The agent is on it', 'success');
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : 'Could not start the agent', 'error');
      },
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="console/agent"
        title="Builder Agent"
        description="Describe a website. The agent plans it, builds it with the generation pipeline, reviews it with the 14-agent mesh, starts it and checks it — every step below is real."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="border-b border-line px-5 py-2.5">
                <p className="font-mono text-xs text-fg-subtle">
                  <span className="text-ember">$</span> nexarch agent
                </p>
              </div>
              <CardContent className="space-y-3 py-4">
                <label htmlFor="agent-task" className="text-sm font-medium text-fg">
                  What should the agent build?
                </label>
                <Textarea
                  id="agent-task"
                  rows={5}
                  value={task}
                  maxLength={MAX_TASK}
                  placeholder="A landing page for… with pricing, testimonials and an FAQ"
                  onChange={(event) => {
                    setTask(event.target.value);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      onClick={() => {
                        setTask(example.task);
                      }}
                      className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="font-mono text-2xs text-fg-subtle">
                    {String(trimmed.length)}/{String(MAX_TASK)}
                  </p>
                  <div className="flex gap-2">
                    {session?.status === 'running' && (
                      <Button
                        type="button"
                        variant="danger"
                        loading={cancel.isPending}
                        icon={<Ban className="size-4" />}
                        onClick={() => {
                          cancel.mutate(session.id);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="submit"
                      variant="forge"
                      disabled={!valid || running}
                      loading={start.isPending}
                      icon={<Hammer className="size-4" />}
                    >
                      Build it
                    </Button>
                  </div>
                </div>
              </CardContent>
            </form>
          </Card>

          {session && (
            <Card>
              <CardContent className="space-y-4 py-4">
                <div>
                  <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                    Task
                  </p>
                  <p className="mt-1 text-sm text-fg">{session.task}</p>
                </div>
                {session.plan.length > 0 && (
                  <div>
                    <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                      Plan
                    </p>
                    <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-fg-muted">
                      {session.plan.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <div>
                  <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                    Steps
                  </p>
                  {session.steps.length === 0 ? (
                    <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
                      <Spinner className="size-3.5" /> Planning…
                    </p>
                  ) : (
                    <ol className="mt-1 divide-y divide-line">
                      {session.steps.map((step) => (
                        <StepRow key={step.id} step={step} />
                      ))}
                    </ol>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {sessions.data && sessions.data.length > 1 && (
            <Card>
              <CardContent className="py-4">
                <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                  Earlier sessions
                </p>
                <ul className="mt-2 space-y-1">
                  {sessions.data.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setParams({ session: item.id });
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised',
                          item.id === selectedId ? 'text-fg' : 'text-fg-muted',
                        )}
                      >
                        <span className="truncate">{item.task}</span>
                        {statusBadge(item.status)}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {session ? (
            <ResultPanel session={session} />
          ) : current.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-danger">
                That session no longer exists — sessions reset when the server restarts.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex h-72 flex-col items-center justify-center gap-2 text-center">
                <MonitorPlay className="size-6 text-fg-subtle" />
                <p className="text-sm text-fg-muted">
                  Give the agent a task — the website it builds appears here.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
