/**
 * Hands a finished run's artifacts to the rest of the console.
 *
 * Every Explorer page (Architecture, Database, Backend, Frontend,
 * Security, Dependency Graph) already reads its stage from a React Query
 * entry keyed by `[stage, projectName, generatedAt]`. The pipeline has
 * already computed all of those server-side, so seeding those exact cache
 * entries is what makes every page show *this run* — instead of quietly
 * regenerating the same thing a second time, one stage per page, the
 * moment the user clicks through.
 */
import { queryClient } from '@/shared/services/query-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { PipelineArtifacts } from '@/shared/types/api';

export function publishArtifacts(artifacts: PipelineArtifacts): void {
  const { setSpec, setArchitecture } = usePipelineStore.getState();
  setSpec(artifacts.requirements);
  setArchitecture(artifacts.architecture);

  const identity = [
    artifacts.architecture.meta.projectName,
    artifacts.architecture.meta.generatedAt,
  ];

  queryClient.setQueryData(['design', ...identity], artifacts.design);
  queryClient.setQueryData(['backend', ...identity], artifacts.backend);
  queryClient.setQueryData(['frontend', ...identity], artifacts.frontend);
  queryClient.setQueryData(['security', ...identity], artifacts.security);
  queryClient.setQueryData(['dependency-graph', ...identity], artifacts.dependencies);
}
