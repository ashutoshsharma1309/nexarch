import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileQuestion, Play, RotateCcw, Square, TerminalSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useGeneratedBackend } from '@/features/backend/use-generated-backend';
import { useGeneratedFrontend } from '@/features/frontend/use-generated-frontend';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import {
  useCreateRunSession,
  useRestartRunSession,
  useRunLogs,
  useRunSession,
  useRunSessions,
  useStopRunSession,
} from '@/shared/hooks/use-runner';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import { toast } from '@/shared/store/toast.store';
import { cn } from '@/shared/lib/cn';
import type { RunPhase, RunSession } from '@/shared/types/api';

const PHASE_VARIANT: Record<RunPhase, 'success' | 'accent' | 'warning' | 'danger' | 'neutral'> = {
  preparing: 'accent',
  installing: 'accent',
  starting: 'accent',
  running: 'success',
  stopping: 'warning',
  stopped: 'neutral',
  restarting: 'accent',
  failed: 'danger',
};

const PHASE_LABEL: Record<RunPhase, string> = {
  preparing: 'Preparing',
  installing: 'Installing',
  starting: 'Compiling',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
  restarting: 'Restarting',
  failed: 'Failed',
};

const ACTIVE_PHASES: RunPhase[] = ['preparing', 'installing', 'starting', 'restarting', 'running'];

function PhaseBadge({ phase }: { phase: RunPhase }) {
  return (
    <Badge variant={PHASE_VARIANT[phase]}>
      <span className="flex items-center gap-1.5">
        {['preparing', 'installing', 'starting', 'restarting', 'stopping'].includes(phase) && (
          <Spinner className="size-3" />
        )}
        {PHASE_LABEL[phase]}
      </span>
    </Badge>
  );
}

function LogViewer({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { lines } = useRunLogs(sessionId, active);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Follow the tail as new lines arrive.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={scrollRef}
      className="h-72 overflow-y-auto rounded-md border border-line bg-canvas p-3"
    >
      {lines.length === 0 ? (
        <p className="text-xs text-fg-subtle">Waiting for output…</p>
      ) : (
        lines.map((line) => (
          <p key={line.seq} className="font-mono text-2xs leading-relaxed whitespace-pre-wrap">
            <span
              className={cn(
                'mr-2',
                line.stream === 'backend' && 'text-accent',
                line.stream === 'frontend' && 'text-success',
                line.stream === 'system' && 'text-fg-subtle',
              )}
            >
              {line.stream}
            </span>
            <span className="text-fg-muted">{line.line}</span>
          </p>
        ))
      )}
    </div>
  );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const session = useRunSession(sessionId);
  const stop = useStopRunSession();
  const restart = useRestartRunSession();

  if (!session.data) {
    return <Skeleton className="h-72" />;
  }
  const data = session.data;
  const active = ACTIVE_PHASES.includes(data.phase);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PhaseBadge phase={data.phase} />
          <p className="text-sm font-medium text-fg">{data.projectName}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!active || stop.isPending}
            onClick={() => {
              stop.mutate(sessionId, {
                onError: (error) => {
                  toast(error.message, 'error');
                },
              });
            }}
          >
            <Square className="size-3.5" /> Stop
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={(active && data.phase !== 'running') || restart.isPending}
            onClick={() => {
              restart.mutate(sessionId, {
                onError: (error) => {
                  toast(error.message, 'error');
                },
              });
            }}
          >
            <RotateCcw className="size-3.5" /> Restart
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {data.processes.map((process) => (
          <div key={process.kind} className="rounded-md border border-line bg-raised/40 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-fg capitalize">{process.kind}</p>
              <Badge variant={process.status === 'running' ? 'success' : 'neutral'}>
                {process.status}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-2xs text-fg-subtle">{process.command}</p>
            {process.url && (
              <a
                href={process.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {process.url} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ))}
      </div>

      {data.diagnostics && data.diagnostics.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
          <p className="text-sm font-medium text-danger">What went wrong</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {data.diagnostics.map((finding) => (
              <li key={finding} className="text-xs text-fg-muted">
                {finding}
              </li>
            ))}
          </ul>
        </div>
      )}

      <LogViewer sessionId={sessionId} active={active} />
    </div>
  );
}

export function RunPage() {
  useDocumentTitle('Run');
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const backend = useGeneratedBackend();
  const frontend = useGeneratedFrontend();
  const sessions = useRunSessions();
  const create = useCreateRunSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeSessionId = selectedId ?? sessions.data?.[0]?.id ?? null;
  const hasProject = Boolean(architecture && backend.data && frontend.data);

  const startRun = () => {
    if (!architecture || !backend.data || !frontend.data) return;
    create.mutate(
      {
        projectName: architecture.meta.projectName,
        files: [
          ...backend.data.files.map((f) => ({ path: `backend/${f.path}`, content: f.content })),
          ...frontend.data.files.map((f) => ({ path: `frontend/${f.path}`, content: f.content })),
        ],
      },
      {
        onSuccess: (session: RunSession) => {
          setSelectedId(session.id);
          toast('Run started — installing dependencies', 'success');
        },
        onError: (error) => {
          toast(error.message, 'error');
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="console/run"
        title="Run"
        description="One-click local run of the generated project — install, start, watch"
        actions={
          <Button onClick={startRun} disabled={!hasProject || create.isPending}>
            {create.isPending ? <Spinner className="size-4" /> : <Play className="size-4" />}
            Run Project
          </Button>
        }
      />

      {!hasProject && !sessions.data?.length ? (
        <EmptyState
          icon={<FileQuestion className="size-4" />}
          title="Nothing to run yet"
          description="Generate a project in the Forge first — the runner installs and starts whatever the pipeline produced."
          action={
            <Button
              onClick={() => {
                void navigate('/forge');
              }}
            >
              Open the Forge
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <TerminalSquare className="size-4" /> Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {sessions.isPending ? (
                <Skeleton className="h-20" />
              ) : !sessions.data || sessions.data.length === 0 ? (
                <p className="text-xs text-fg-subtle">No runs yet.</p>
              ) : (
                sessions.data.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(session.id);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                      session.id === activeSessionId
                        ? 'bg-raised text-fg'
                        : 'text-fg-muted hover:bg-raised/60',
                    )}
                  >
                    <span className="truncate">{session.projectName}</span>
                    <PhaseBadge phase={session.phase} />
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              {activeSessionId ? (
                <SessionDetail sessionId={activeSessionId} />
              ) : (
                <p className="py-12 text-center text-sm text-fg-subtle">
                  Press “Run Project” to install, start and watch the generated app.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
