import { useMutation, useQuery } from '@tanstack/react-query';

import {
  executeDeploy,
  exportDeployment,
  generateDeployment,
  getDeployExecution,
  getDeployProviders,
  getDeploymentHealth,
  getDeploymentStatus,
  planDeployExecution,
} from '@/shared/services/deployment.service';
import type {
  DeploymentExportFormat,
  DeploymentTarget,
  ExecuteDeployRequest,
  ProjectArtifacts,
} from '@/shared/types/api';

export function useGenerateDeployment() {
  return useMutation({
    mutationFn: ({
      target,
      artifacts,
    }: {
      target: DeploymentTarget;
      artifacts: ProjectArtifacts;
    }) => generateDeployment(target, artifacts),
  });
}

export function useExportDeployment() {
  return useMutation({
    mutationFn: ({
      format,
      target,
      artifacts,
    }: {
      format: DeploymentExportFormat;
      target: DeploymentTarget;
      artifacts: ProjectArtifacts;
    }) => exportDeployment(format, target, artifacts),
  });
}

export function useDeploymentStatus() {
  return useQuery({
    queryKey: ['deployment', 'status'],
    queryFn: () => getDeploymentStatus(),
  });
}

export function useDeploymentHealth() {
  return useQuery({
    queryKey: ['deployment', 'health'],
    queryFn: () => getDeploymentHealth(),
  });
}

/* ── One-click deploy execution (Phase 13) ────────────────────────────── */

export function useDeployProviders() {
  return useQuery({ queryKey: ['deployment', 'providers'], queryFn: getDeployProviders });
}

export function usePlanDeployExecution() {
  return useMutation({
    mutationFn: (request: ExecuteDeployRequest) => planDeployExecution(request),
  });
}

export function useExecuteDeploy() {
  return useMutation({ mutationFn: (request: ExecuteDeployRequest) => executeDeploy(request) });
}

const ACTIVE_DEPLOY_PHASES = ['queued', 'building', 'deploying', 'monitoring'];

/** Polls while the execution is in flight, goes quiet once it's live or failed. */
export function useDeployExecution(id: string | null) {
  return useQuery({
    queryKey: ['deployment', 'execution', id],
    queryFn: () => {
      if (!id) throw new Error('No execution selected');
      return getDeployExecution(id);
    },
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase && ACTIVE_DEPLOY_PHASES.includes(phase) ? 2_000 : false;
    },
  });
}
