import type {
  ApiSuccess,
  DeploymentBundle,
  DeploymentExportFormat,
  DeploymentHealthPreview,
  DeploymentStatus,
  DeploymentTarget,
  ExportResult,
  ProjectArtifacts,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export async function generateDeployment(
  target: DeploymentTarget,
  artifacts: ProjectArtifacts,
): Promise<DeploymentBundle> {
  const response = await apiClient.post<ApiSuccess<DeploymentBundle>>('/deployment/generate', {
    target,
    artifacts,
  });
  return unwrap(response.data);
}

export async function exportDeployment(
  format: DeploymentExportFormat,
  target: DeploymentTarget,
  artifacts: ProjectArtifacts,
): Promise<ExportResult> {
  const response = await apiClient.post<ApiSuccess<ExportResult>>('/deployment/export', {
    format,
    target,
    artifacts,
  });
  return unwrap(response.data);
}

export async function getDeploymentStatus(): Promise<DeploymentStatus> {
  const response = await apiClient.get<ApiSuccess<DeploymentStatus>>('/deployment/status');
  return unwrap(response.data);
}

export async function getDeploymentHealth(): Promise<DeploymentHealthPreview> {
  const response = await apiClient.get<ApiSuccess<DeploymentHealthPreview>>('/deployment/health');
  return unwrap(response.data);
}
