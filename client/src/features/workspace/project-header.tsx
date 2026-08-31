/**
 * Project identity and the one action that matters right now.
 *
 * The primary button is state-driven rather than fixed: a project with no
 * runs offers Build, one mid-run shows the stage it is on (and goes to the
 * Build tab), and one that has finished offers Rebuild. A button whose
 * label never changes forces the user to work out which of its meanings
 * applies; this one just says.
 */
import { Hammer, MonitorPlay, RefreshCw, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import { formatRelativeTime } from '@/shared/lib/format';
import type { ProjectStatus } from '@/shared/types/api';
import type { ProjectWorkspace } from './use-project-workspace';

const statusVariant: Record<ProjectStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

/** The single sentence that describes where this project stands. */
function runSummary(workspace: ProjectWorkspace): { label: string; tone: 'ok' | 'busy' | 'bad' } {
  if (workspace.isBuilding) {
    const stage = workspace.liveRun?.stages.find((s) => s.status === 'running');
    return { label: stage ? `Building · ${stage.label}` : 'Building', tone: 'busy' };
  }
  const newest = workspace.runs[0];
  if (!newest) return { label: 'Never built', tone: 'ok' };
  if (newest.status === 'FAILED') return { label: 'Last build failed', tone: 'bad' };
  if (workspace.latestRun) {
    return { label: `Built ${formatRelativeTime(workspace.latestRun.createdAt)}`, tone: 'ok' };
  }
  return { label: newest.status.toLowerCase(), tone: 'busy' };
}

export function ProjectHeader({ workspace }: { workspace: ProjectWorkspace }) {
  const navigate = useNavigate();
  const project = workspace.project;
  if (!project) return null;

  const base = `/projects/${project.id}`;
  const run = runSummary(workspace);
  const hasBuild = Boolean(workspace.latestRun);

  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{project.name}</h1>
          <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span
            className={
              run.tone === 'bad' ? 'text-danger' : run.tone === 'busy' ? 'text-ember' : undefined
            }
          >
            {run.tone === 'busy' && <Spinner className="mr-1 inline size-3 align-[-2px]" />}
            {run.label}
          </span>
          <span aria-hidden="true" className="text-fg-subtle">
            ·
          </span>
          <span>Updated {formatRelativeTime(project.updatedAt)}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={<Settings2 className="size-3.5" />}
          onClick={() => {
            void navigate('/settings');
          }}
        >
          <span className="hidden sm:inline">Settings</span>
        </Button>
        <Button
          size="sm"
          icon={<MonitorPlay className="size-3.5" />}
          disabled={!hasBuild}
          title={hasBuild ? undefined : 'Build the project first'}
          onClick={() => {
            void navigate(`${base}/preview`);
          }}
        >
          Preview
        </Button>
        <Button
          variant="forge"
          size="sm"
          icon={
            workspace.isBuilding ? undefined : hasBuild ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Hammer className="size-3.5" />
            )
          }
          loading={workspace.isBuilding}
          onClick={() => {
            void navigate(`${base}/build`);
          }}
        >
          {workspace.isBuilding ? 'Building…' : hasBuild ? 'Rebuild' : 'Build project'}
        </Button>
      </div>
    </header>
  );
}
