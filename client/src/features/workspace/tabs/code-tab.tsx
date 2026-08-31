/**
 * Everything the generators emitted, in one place.
 *
 * Backend and frontend used to be separate destinations that each showed
 * half a project. The file explorer built for Preview already renders the
 * whole tree — both halves, security overlay included, with syntax
 * highlighting and copy — so it is reused here rather than rebuilt, and
 * the per-side manifests (modules, routes, pages, stores) sit behind a
 * segmented control next to it.
 *
 * This is not an IDE and does not try to be: read, navigate, copy, export.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';

import { BackendWorkspace } from '@/features/backend/backend-page';
import { FrontendWorkspace } from '@/features/frontend/frontend-page';
import { FileExplorer } from '@/features/preview/file-explorer';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/cn';
import { downloadZip } from '@/shared/lib/zip';
import { slugify } from '@/shared/lib/slugify';
import { toast } from '@/shared/store/toast.store';
import { useWorkspace } from '../workspace-context';
import { BuildRequiredState } from './build-required-state';

type View = 'files' | 'backend' | 'frontend';

export function CodeTab() {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>('files');

  if (!workspace.latestRun) return <BuildRequiredState what="the code" />;
  if (!workspace.artifacts) {
    return (
      <BuildRequiredState
        what="the code"
        missing={workspace.artifactsMissing}
        loading={!workspace.artifactsMissing}
      />
    );
  }

  const artifacts = workspace.artifacts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Code views"
          className="inline-flex rounded-md border border-line p-0.5"
        >
          {(
            [
              ['files', `Files (${artifacts.files.length})`],
              ['backend', 'Backend'],
              ['frontend', 'Frontend'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => {
                setView(value);
              }}
              className={cn(
                'rounded px-3 py-1 text-xs transition-colors',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                view === value ? 'bg-raised font-medium text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          icon={<Download className="size-3.5" />}
          onClick={() => {
            downloadZip(
              `${slugify(workspace.project?.name ?? 'project', 'project')}.zip`,
              artifacts.files,
            );
            toast(`Exported ${String(artifacts.files.length)} files`, 'success');
          }}
        >
          Download ZIP
        </Button>
      </div>

      {view === 'files' && <FileExplorer files={artifacts.files} />}
      {view === 'backend' && <BackendWorkspace />}
      {view === 'frontend' && <FrontendWorkspace />}
    </div>
  );
}
