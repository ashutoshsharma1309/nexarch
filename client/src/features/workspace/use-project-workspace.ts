/**
 * Everything a project workspace needs, resolved once for all its tabs.
 *
 * A project's content is whatever its most recent successful run produced.
 * So this hook walks that chain — project → runs → latest completed run →
 * artifacts — and then hands the artifacts to `publishArtifacts`, which
 * seeds the exact React Query keys the Architecture, Database, Code,
 * Security and Dependency views already read from.
 *
 * That last step is the whole reason the tabs needed no rewriting: they
 * were already reading a run's output from cache, they just had no way to
 * be told *which* run. Now the project says.
 *
 * Artifacts are process-local on the server (see the pipeline's run store),
 * so a run recorded before the last restart has a database row and no
 * content. `artifactsMissing` reports exactly that case, because "rebuild
 * this project" and "something went wrong" are different messages.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { publishArtifacts } from '@/features/pipeline/publish-artifacts';
import { usePipelineArtifacts, usePipelineRun } from '@/shared/hooks/use-pipeline';
import { useProjectDashboard } from '@/shared/hooks/use-workspace';
import { listProjectRuns } from '@/shared/services/workspace.service';
import type { PipelineArtifacts, PipelineRun, Project, Run } from '@/shared/types/api';

export interface ProjectWorkspace {
  project: Project | undefined;
  /** Durable run history, newest first. */
  runs: Run[];
  /** The run whose output the workspace is showing, if any. */
  latestRun: Run | undefined;
  /** Live stage state for the newest run — polls only while it is running. */
  liveRun: PipelineRun | undefined;
  artifacts: PipelineArtifacts | undefined;
  /** The project has a completed run, but the server no longer holds its output. */
  artifactsMissing: boolean;
  isLoading: boolean;
  isBuilding: boolean;
  error: Error | null;
  notFound: boolean;
}

export function useProjectWorkspace(projectId: string | undefined): ProjectWorkspace {
  const dashboard = useProjectDashboard(projectId);

  const runsQuery = useQuery({
    queryKey: ['project', projectId, 'runs'],
    // `enabled` guarantees an id by the time this runs; the throw is the
    // honest way to say so without an assertion that lies about the type.
    queryFn: () => {
      if (!projectId) throw new Error('No project selected');
      return listProjectRuns(projectId);
    },
    enabled: Boolean(projectId),
    // A build in flight appends runs; a short stale window keeps the
    // history honest without polling it like live state.
    staleTime: 5_000,
  });

  const runs = runsQuery.data ?? [];
  const newestRun = runs[0];
  const latestRun = runs.find((run) => run.status === 'COMPLETED');

  // Only the newest run can still be in flight, so that is the only one
  // worth polling for live stage state.
  const inFlight = newestRun && newestRun.status !== 'COMPLETED' && newestRun.status !== 'FAILED';
  const liveRun = usePipelineRun(inFlight ? newestRun.id : null);

  const artifacts = usePipelineArtifacts(
    latestRun ? ({ id: latestRun.id, status: 'completed' } as PipelineRun) : undefined,
  );

  // Hand the run's output to every view that reads from the query cache.
  useEffect(() => {
    if (artifacts.data) publishArtifacts(artifacts.data);
  }, [artifacts.data]);

  const notFound = dashboard.isError && /not found/i.test(dashboard.error.message);

  return {
    project: dashboard.data?.project,
    runs,
    latestRun,
    liveRun: liveRun.data,
    artifacts: artifacts.data,
    artifactsMissing: Boolean(latestRun) && artifacts.isError,
    isLoading: dashboard.isPending || runsQuery.isPending,
    isBuilding: Boolean(inFlight),
    error: dashboard.error ?? runsQuery.error,
    notFound,
  };
}
