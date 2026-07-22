import { useMutation, useQuery } from '@tanstack/react-query';

import {
  exportDeployment,
  generateDeployment,
  getDeploymentHealth,
  getDeploymentStatus,
} from '@/shared/services/deployment.service';
import type {
  DeploymentExportFormat,
  DeploymentTarget,
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
