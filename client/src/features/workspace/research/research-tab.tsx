/**
 * The research behind the latest completed build, read from the stored
 * artifact. "Did not run", "no stored output" and "ran and found nothing" are
 * three different answers and each gets its own screen.
 */
import { Telescope } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useRunResearch } from '@/shared/hooks/use-research';
import { ApiClientError } from '@/shared/services/api-client';
import type { PipelineArtifacts } from '@/shared/types/api';
import { BuildRequiredState } from '../tabs/build-required-state';
import { useWorkspace } from '../workspace-context';
import { ResearchReport } from './research-report';

const ICON = <Telescope className="size-4" />;

function Loading() {
  return (
    <div role="status" aria-label="Loading research" className="space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function appliedStages(artifacts: PipelineArtifacts | undefined, runId: string) {
  if (artifacts?.runId !== runId) return undefined;
  return artifacts.researchAppliedTo;
}

export function ResearchTab() {
  const workspace = useWorkspace();
  const projectId = workspace.project?.id;
  const run = workspace.latestRun;
  const query = useRunResearch(projectId, run?.id);

  if (workspace.isLoading) return <Loading />;

  if (!run) {
    if (!workspace.isBuilding) return <BuildRequiredState what="research" />;
    return (
      <EmptyState
        icon={ICON}
        title="No research to show yet"
        description="Research is stored when a build completes. This project's first build is still going."
        action={
          <Link
            to="../execution"
            relative="path"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Follow the build
          </Link>
        }
      />
    );
  }

  if (query.isPending) return <Loading />;

  if (query.isError) {
    if (query.error instanceof ApiClientError && query.error.status === 404) {
      return (
        <EmptyState
          icon={ICON}
          title="No stored output for this build"
          description="The server no longer holds this build's output, so its research cannot be read."
        />
      );
    }
    return (
      <EmptyState
        icon={ICON}
        title="Could not load research"
        description={query.error.message}
        action={
          <Button
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  if (query.data.research === null) {
    return (
      <EmptyState
        icon={ICON}
        title="Research did not run for this build"
        description="This build was made without web research, so there are no sources or findings for it."
      />
    );
  }

  return (
    <div className="space-y-4">
      {workspace.isBuilding && (
        <p role="status" className="text-xs text-fg-muted">
          A newer build is running. This is the research from the last completed build.
        </p>
      )}
      <ResearchReport
        research={query.data.research}
        appliedTo={appliedStages(workspace.artifacts, run.id)}
      />
    </div>
  );
}
