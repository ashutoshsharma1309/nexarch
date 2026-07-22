import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createProject,
  deleteProject,
  duplicateProject,
  generateDocumentation,
  getProjectDashboard,
  getWorkspaceHistory,
  getWorkspaceStatistics,
  recordGeneration,
  runExport,
  updateProject,
} from '@/shared/services/workspace.service';
import type {
  ListProjectsParams,
  RecordGenerationInput,
} from '@/shared/services/workspace.service';
import type {
  CreateProjectInput,
  DocumentationType,
  ExportFormat,
  ProjectArtifacts,
  UpdateProjectInput,
} from '@/shared/types/api';

const PROJECTS_KEY = ['projects'];
const STATISTICS_KEY = ['workspace', 'statistics'];
const HISTORY_KEY = ['workspace', 'history'];

function invalidateProjects(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
  void queryClient.invalidateQueries({ queryKey: STATISTICS_KEY });
  void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
}

export function useProjectDashboard(id: string | undefined) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, id],
    queryFn: () => {
      if (!id) throw new Error('A project id is required');
      return getProjectDashboard(id);
    },
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess: () => {
      invalidateProjects(queryClient);
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectInput }) =>
      updateProject(id, input),
    onSuccess: () => {
      invalidateProjects(queryClient);
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      invalidateProjects(queryClient);
    },
  });
}

export function useDuplicateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateProject(id),
    onSuccess: () => {
      invalidateProjects(queryClient);
    },
  });
}

export function useRecordGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, input }: { projectId: string; input: RecordGenerationInput }) =>
      recordGeneration(projectId, input),
    onSuccess: (_result, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: [...PROJECTS_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    },
  });
}

export function useWorkspaceStatistics() {
  return useQuery({
    queryKey: STATISTICS_KEY,
    queryFn: () => getWorkspaceStatistics(),
  });
}

export function useWorkspaceHistory(params?: { projectId?: string; limit?: number }) {
  return useQuery({
    queryKey: [...HISTORY_KEY, params?.projectId, params?.limit],
    queryFn: () => getWorkspaceHistory(params),
  });
}

export function useGenerateDocumentation() {
  return useMutation({
    mutationFn: ({ type, artifacts }: { type: DocumentationType; artifacts: ProjectArtifacts }) =>
      generateDocumentation(type, artifacts),
  });
}

export function useRunExport() {
  return useMutation({
    mutationFn: ({
      format,
      artifacts,
      projectId,
    }: {
      format: ExportFormat;
      artifacts: ProjectArtifacts;
      projectId?: string;
    }) => runExport(format, artifacts, projectId),
  });
}

export type { ListProjectsParams };
