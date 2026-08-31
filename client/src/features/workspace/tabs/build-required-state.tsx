/**
 * The shared "there is nothing to show yet" screen for every workspace tab.
 *
 * Three genuinely different situations, three different messages. Loading
 * is not an empty state, a project that has never been built is not an
 * error, and a completed run whose output the server has since dropped is
 * neither — it is a specific, explainable condition with a specific fix.
 * Collapsing them into one "no data" panel is what makes an interface feel
 * broken when it is working correctly.
 */
import { Hammer, PackageX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useWorkspace } from '../workspace-context';

export function BuildRequiredState({
  missing = false,
  loading = false,
  what = 'this project',
}: {
  /** A run exists but the server no longer holds its artifacts. */
  missing?: boolean;
  loading?: boolean;
  what?: string;
}) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const base = `/projects/${workspace.project?.id ?? ''}`;

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading generated output">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (workspace.isBuilding) {
    return (
      <EmptyState
        icon={<Hammer className="size-4" />}
        title="This project is building"
        description="Stages are running now. The Build tab shows each one as it completes."
        action={
          <Button
            variant="primary"
            onClick={() => {
              void navigate(`${base}/build`);
            }}
          >
            Watch the build
          </Button>
        }
      />
    );
  }

  if (missing) {
    return (
      <EmptyState
        icon={<PackageX className="size-4" />}
        title="This build’s output is no longer available"
        description="Generated files are held in the API process, so they don’t survive a server restart. The run is still in this project’s history — rebuild to produce the output again."
        action={
          <Button
            variant="forge"
            icon={<Hammer className="size-3.5" />}
            onClick={() => {
              void navigate(`${base}/build`);
            }}
          >
            Rebuild
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<Hammer className="size-4" />}
      title={`Nothing generated for ${what} yet`}
      description="Describe what you want built and NexArch will analyze it, plan the architecture, generate the code and harden it — then you can preview it on localhost."
      action={
        <Button
          variant="forge"
          icon={<Hammer className="size-3.5" />}
          onClick={() => {
            void navigate(`${base}/build`);
          }}
        >
          Build project
        </Button>
      }
    />
  );
}
