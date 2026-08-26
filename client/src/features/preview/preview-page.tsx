import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  MonitorPlay,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { publishArtifacts } from '@/features/pipeline/publish-artifacts';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { usePipelineArtifacts, usePipelineRun } from '@/shared/hooks/use-pipeline';
import {
  useCreateRunSession,
  useRestartRunSession,
  useRunLogs,
  useRunSession,
  useRunSessions,
  useStopRunSession,
} from '@/shared/hooks/use-runner';
import { cn } from '@/shared/lib/cn';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { toast } from '@/shared/store/toast.store';
import type { PipelineArtifacts, RunPhase, RunSession } from '@/shared/types/api';
import { FileExplorer } from './file-explorer';

const PHASE_LABEL: Record<RunPhase, string> = {
  preparing: 'Writing workspace',
  installing: 'Installing dependencies',
  configuring: 'Configuring database',
  starting: 'Starting processes',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
  restarting: 'Restarting',
  failed: 'Failed',
};

const PHASE_VARIANT: Record<RunPhase, 'success' | 'accent' | 'warning' | 'danger' | 'neutral'> = {
  preparing: 'accent',
  installing: 'accent',
  configuring: 'accent',
  starting: 'accent',
  running: 'success',
  stopping: 'warning',
  stopped: 'neutral',
  restarting: 'accent',
  failed: 'danger',
};

const BUSY_PHASES: RunPhase[] = [
  'preparing',
  'installing',
  'configuring',
  'starting',
  'restarting',
  'stopping',
];

type Tab = 'app' | 'structure' | 'logs';

function PhaseBadge({ phase }: { phase: RunPhase }) {
  return (
    <Badge variant={PHASE_VARIANT[phase]}>
      <span className="flex items-center gap-1.5">
        {BUSY_PHASES.includes(phase) && <Spinner className="size-3" />}
        {PHASE_LABEL[phase]}
      </span>
    </Badge>
  );
}

function LogPane({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { lines } = useRunLogs(sessionId, active);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={scrollRef}
      className="h-[32rem] overflow-y-auto rounded-lg border border-line bg-canvas p-3"
    >
      {lines.length === 0 ? (
        <p className="text-xs text-fg-subtle">Waiting for output…</p>
      ) : (
        lines.map((line) => (
          <p key={line.seq} className="font-mono text-2xs leading-relaxed whitespace-pre-wrap">
            <span
              className={cn(
                'mr-2 inline-block w-14 shrink-0',
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

/**
 * The running application, framed.
 *
 * The iframe points at the generated frontend's own dev server on its own
 * localhost port — this is the real app, not a mock of it, which is why
 * every button and route inside it behaves exactly as it will when the user
 * runs the exported project themselves. The "Open in a new tab" escape
 * hatch matters because some generated flows (auth redirects, deep links)
 * are easier to judge outside a frame.
 */
function LiveApp({ session }: { session: RunSession }) {
  const [nonce, setNonce] = useState(0);
  const frontend = session.processes.find((process) => process.kind === 'frontend');
  const backend = session.processes.find((process) => process.kind === 'backend');

  if (session.phase === 'failed') {
    return (
      <Card className="border-danger/40">
        <CardContent className="space-y-2 py-5">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            <AlertTriangle className="size-4 text-danger" />
            The preview could not start
          </p>
          {(session.diagnostics ?? ['No diagnostics were captured.']).map((line) => (
            <p key={line} className="text-xs text-fg-muted">
              {line}
            </p>
          ))}
          <p className="text-xs text-fg-subtle">
            The Logs tab has the full output from the install and start steps.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (session.phase !== 'running' || !frontend?.url) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Spinner />
          <p className="text-sm text-fg">{PHASE_LABEL[session.phase]}</p>
          <p className="max-w-sm text-xs text-fg-muted">
            The first run installs dependencies for both the generated backend and frontend, so it
            takes a minute or two. Watch it happen in the Logs tab.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-2xs text-fg-subtle">
            frontend <span className="text-success">{frontend.url}</span>
          </p>
          {backend?.url && (
            <p className="font-mono text-2xs text-fg-subtle">
              api <span className="text-accent">{backend.url}</span>
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="size-3.5" />}
            onClick={() => {
              setNonce((value) => value + 1);
            }}
          >
            Reload
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink className="size-3.5" />}
            onClick={() => {
              window.open(frontend.url ?? '', '_blank', 'noopener,noreferrer');
            }}
          >
            Open in a new tab
          </Button>
        </div>
      </div>

      <iframe
        key={nonce}
        src={frontend.url}
        title={`${session.projectName} preview`}
        className="h-[36rem] w-full rounded-lg border border-line bg-white"
      />
    </div>
  );
}

/** A phase that means "this session still owns its ports and workspace". */
const LIVE_PHASES: RunPhase[] = [...BUSY_PHASES, 'running'];

function PreviewWorkspace({ artifacts }: { artifacts: PipelineArtifacts }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('app');

  const create = useCreateRunSession();
  const stop = useStopRunSession();
  const restart = useRestartRunSession();
  const sessions = useRunSessions();
  const session = useRunSession(sessionId);

  const projectName = artifacts.architecture.meta.projectName;

  // Reopening this page — a reload, a bookmark, coming back from another
  // route — must reattach to the run that is already up rather than offer to
  // install the same project a second time onto ports the first one holds.
  const liveSession = sessions.data?.find(
    (candidate) => candidate.projectName === projectName && LIVE_PHASES.includes(candidate.phase),
  );
  useEffect(() => {
    if (!sessionId && liveSession) setSessionId(liveSession.id);
  }, [sessionId, liveSession]);
  const phase = session.data?.phase ?? null;
  const busy = phase !== null && BUSY_PHASES.includes(phase);

  const startPreview = (): void => {
    create.mutate(
      { projectName, files: artifacts.files },
      {
        onSuccess: (created) => {
          setSessionId(created.id);
          setTab('logs');
          toast('Preview starting — installing dependencies', 'success');
        },
        onError: (error) => {
          toast(error instanceof Error ? error.message : 'Could not start the preview', 'error');
        },
      },
    );
  };

  // Once the app is actually up, put the user in front of it.
  useEffect(() => {
    if (phase === 'running') setTab('app');
  }, [phase]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'app', label: 'Live app' },
    { id: 'structure', label: `Project (${String(artifacts.files.length)} files)` },
    { id: 'logs', label: 'Logs' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="console/preview"
        title={projectName}
        description="The generated project, installed and running on localhost."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Download className="size-3.5" />}
              onClick={() => {
                downloadZip(`${slugify(projectName, 'generated-project')}.zip`, artifacts.files);
                toast(`Exported ${String(artifacts.files.length)} files`, 'success');
              }}
            >
              Download ZIP
            </Button>

            {sessionId && phase === 'running' && (
              <Button
                icon={<Square className="size-3.5" />}
                loading={stop.isPending}
                onClick={() => {
                  stop.mutate(sessionId);
                }}
              >
                Stop
              </Button>
            )}

            {sessionId && (phase === 'stopped' || phase === 'failed') && (
              <Button
                icon={<RotateCcw className="size-3.5" />}
                loading={restart.isPending}
                onClick={() => {
                  restart.mutate(sessionId);
                }}
              >
                Restart
              </Button>
            )}

            {!sessionId && (
              <Button
                variant="forge"
                icon={<Play className="size-3.5" />}
                loading={create.isPending}
                onClick={startPreview}
              >
                Run preview
              </Button>
            )}
          </div>
        }
      />

      {session.data && (
        <div className="flex flex-wrap items-center gap-2">
          <PhaseBadge phase={session.data.phase} />
          {session.data.processes.map((process) => (
            <Badge
              key={process.kind}
              variant={process.status === 'running' ? 'success' : 'neutral'}
            >
              {process.kind}
              {process.port ? ` :${String(process.port)}` : ''}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-line" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => {
              setTab(entry.id);
            }}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[0.8125rem] transition-colors',
              tab === entry.id
                ? 'border-ember text-fg'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'app' &&
        (session.data ? (
          <LiveApp session={session.data} />
        ) : (
          <EmptyState
            icon={<MonitorPlay className="size-4" />}
            title="The preview isn't running yet"
            description="Press Run preview to install this project's dependencies and start it on its own localhost ports. NexArch itself stays available while it runs."
            action={
              <Button
                variant="forge"
                icon={<Play className="size-3.5" />}
                loading={create.isPending}
                onClick={startPreview}
              >
                Run preview
              </Button>
            }
          />
        ))}

      {tab === 'structure' && <FileExplorer files={artifacts.files} />}

      {tab === 'logs' &&
        (sessionId ? (
          <LogPane sessionId={sessionId} active={busy || phase === 'running'} />
        ) : (
          <p className="py-12 text-center text-sm text-fg-subtle">
            Logs appear once the preview starts.
          </p>
        ))}

      {session.data?.workspaceDir && (
        <p className="flex items-center gap-1.5 font-mono text-2xs text-fg-subtle">
          <TerminalSquare className="size-3" />
          {session.data.workspaceDir}
        </p>
      )}
    </div>
  );
}

export function PreviewPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const run = usePipelineRun(runId ?? null);
  const artifacts = usePipelineArtifacts(run.data);

  useDocumentTitle(run.data ? `Preview · ${run.data.projectName}` : 'Preview');

  // Landing here directly (a reload, a bookmarked link) has to repopulate the
  // rest of the console too, or the Explorer pages would be empty behind it.
  useEffect(() => {
    if (artifacts.data) publishArtifacts(artifacts.data);
  }, [artifacts.data]);

  if (run.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-4" />}
        title="That run isn't available"
        description="Generation runs live in the API process and don't survive a server restart. Generate the project again to preview it."
        action={
          <Button
            variant="forge"
            onClick={() => {
              void navigate('/forge');
            }}
          >
            Open the Forge
          </Button>
        }
      />
    );
  }

  if (!artifacts.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return <PreviewWorkspace artifacts={artifacts.data} />;
}
