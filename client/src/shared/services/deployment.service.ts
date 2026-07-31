import type {
  ApiSuccess,
  DeployExecution,
  DeployExecutionPlan,
  DeployProviderStatus,
  DeploymentBundle,
  DeploymentExportFormat,
  DeploymentHealthPreview,
  DeploymentStatus,
  DeploymentTarget,
  ExecuteDeployRequest,
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

/* ── One-click deploy execution (Phase 13) ────────────────────────────── */

export async function getDeployProviders(): Promise<DeployProviderStatus[]> {
  const response = await apiClient.get<ApiSuccess<DeployProviderStatus[]>>('/deployment/providers');
  return unwrap(response.data);
}

export async function planDeployExecution(
  request: ExecuteDeployRequest,
): Promise<DeployExecutionPlan> {
  const response = await apiClient.post<ApiSuccess<DeployExecutionPlan>>(
    '/deployment/execute/plan',
    request,
  );
  return unwrap(response.data);
}

export async function executeDeploy(request: ExecuteDeployRequest): Promise<DeployExecution> {
  const response = await apiClient.post<ApiSuccess<DeployExecution>>(
    '/deployment/execute',
    request,
    { timeout: 60_000 },
  );
  return unwrap(response.data);
}

export async function getDeployExecution(id: string): Promise<DeployExecution> {
  const response = await apiClient.get<ApiSuccess<DeployExecution>>(`/deployment/executions/${id}`);
  return unwrap(response.data);
}
