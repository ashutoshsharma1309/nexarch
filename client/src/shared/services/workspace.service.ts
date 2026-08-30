import type {
  ApiSuccess,
  CreateProjectInput,
  DocumentationResult,
  DocumentationType,
  ExportFormat,
  ExportResult,
  Generation,
  GenerationStatus,
  Project,
  ProjectArtifacts,
  ProjectDashboard,
  Run,
  UpdateProjectInput,
  WorkspaceHistory,
  WorkspaceStatistics,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const response = await apiClient.post<ApiSuccess<Project>>('/projects', input);
  return unwrap(response.data);
}

export interface ListProjectsParams {
  search?: string;
  status?: Project['status'];
  favorite?: boolean;
}

export async function listProjects(params?: ListProjectsParams): Promise<Project[]> {
  const response = await apiClient.get<ApiSuccess<Project[]>>('/projects', { params });
  return unwrap(response.data);
}

export async function getProjectDashboard(id: string): Promise<ProjectDashboard> {
  const response = await apiClient.get<ApiSuccess<ProjectDashboard>>(`/project/${id}`);
  return unwrap(response.data);
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const response = await apiClient.patch<ApiSuccess<Project>>(`/project/${id}`, input);
  return unwrap(response.data);
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(`/project/${id}`);
}

export async function duplicateProject(id: string): Promise<Project> {
  const response = await apiClient.post<ApiSuccess<Project>>(`/project/${id}/duplicate`);
  return unwrap(response.data);
}

export interface RecordGenerationInput {
  prompt: string;
  status?: GenerationStatus;
  model?: string;
  tokensUsed?: number;
  costUsd?: number;
  durationMs?: number;
  error?: string;
}

export async function recordGeneration(
  projectId: string,
  input: RecordGenerationInput,
): Promise<Generation> {
  const response = await apiClient.post<ApiSuccess<Generation>>(
    `/project/${projectId}/generations`,
    input,
  );
  return unwrap(response.data);
}

export async function getWorkspaceStatistics(): Promise<WorkspaceStatistics> {
  const response = await apiClient.get<ApiSuccess<WorkspaceStatistics>>('/statistics');
  return unwrap(response.data);
}

export async function getWorkspaceHistory(params?: {
  projectId?: string;
  limit?: number;
}): Promise<WorkspaceHistory> {
  const response = await apiClient.get<ApiSuccess<WorkspaceHistory>>('/history', { params });
  return unwrap(response.data);
}

export async function generateDocumentation(
  type: DocumentationType,
  artifacts: ProjectArtifacts,
): Promise<DocumentationResult> {
  const response = await apiClient.post<ApiSuccess<DocumentationResult>>('/documentation', {
    type,
    artifacts,
  });
  return unwrap(response.data);
}

export async function runExport(
  format: ExportFormat,
  artifacts: ProjectArtifacts,
  projectId?: string,
): Promise<ExportResult> {
  const response = await apiClient.post<ApiSuccess<ExportResult>>('/export', {
    format,
    artifacts,
    projectId,
  });
  return unwrap(response.data);
}

/**
 * A project's durable run history. Distinct from `fetchRuns()` in
 * `pipeline.service`, which lists only the runs this server process still
 * holds in memory — these come from the database and survive a restart.
 */
export async function listProjectRuns(projectId: string): Promise<Run[]> {
  const { data } = await apiClient.get<ApiSuccess<Run[]>>(`/project/${projectId}/runs`);
  return unwrap(data);
}
