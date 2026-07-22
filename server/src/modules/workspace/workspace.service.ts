/**
 * Workspace service — project management, generation history, workspace
 * activity, documentation, and export, composed from the `lib/` primitives.
 * Every mutation also appends to the activity log so `GET /history` can
 * show a live feed without the controller having to know the log's shape.
 */
import { AppError } from '../../shared/utils/app-error.js';
import { logActivity, listActivity as listActivityEntries } from './lib/activity-log.js';
import { runExport as runExportInternal } from './lib/export-manager.js';
import {
  deleteGenerationsForProject,
  listGenerations as listGenerationRecords,
  recordGeneration as recordGenerationInternal,
} from './lib/generation-log.js';
import {
  createProject as createProjectInternal,
  deleteProject as deleteProjectInternal,
  duplicateProject as duplicateProjectInternal,
  getProject as getProjectInternal,
  listProjects as listProjectsInternal,
  projectStatistics,
  updateProject as updateProjectInternal,
} from './lib/project-store.js';
import { generateDocumentation as generateDocumentationInternal } from './lib/documentation-generator.js';
import type {
  ActivityLogEntry,
  CreateGenerationInput,
  CreateProjectInput,
  DocumentationRequest,
  DocumentationResult,
  ExportRequest,
  ExportResult,
  GenerationRecord,
  ListProjectsQuery,
  Project,
  ProjectDashboard,
  UpdateProjectInput,
  WorkspaceStatistics,
} from './workspace.types.js';

export function createProject(input: CreateProjectInput): Project {
  const project = createProjectInternal(input);
  logActivity('project.created', `Created project "${project.name}"`, project.id, project.name);
  return project;
}

export function listProjects(query: ListProjectsQuery): Project[] {
  return listProjectsInternal(query);
}

export function getProjectOrThrow(id: string): Project {
  const project = getProjectInternal(id);
  if (!project) throw AppError.notFound(`Project "${id}" not found`);
  return project;
}

export function updateProject(id: string, input: UpdateProjectInput): Project {
  const before = getProjectOrThrow(id);
  const updated = updateProjectInternal(id, input);
  if (!updated) throw AppError.notFound(`Project "${id}" not found`);

  if (input.name && input.name !== before.name) {
    logActivity(
      'project.renamed',
      `Renamed "${before.name}" to "${updated.name}"`,
      id,
      updated.name,
    );
  }
  if (input.status && input.status !== before.status) {
    const type = input.status === 'ARCHIVED' ? 'project.archived' : 'project.unarchived';
    logActivity(type, `"${updated.name}" set to ${updated.status}`, id, updated.name);
  }
  if (input.favorite !== undefined && input.favorite !== before.favorite) {
    const type = input.favorite ? 'project.favorited' : 'project.unfavorited';
    logActivity(
      type,
      `"${updated.name}" ${input.favorite ? 'favorited' : 'unfavorited'}`,
      id,
      updated.name,
    );
  }
  if (
    !input.name &&
    !input.status &&
    input.favorite === undefined &&
    input.description !== undefined
  ) {
    logActivity('project.updated', `Updated description for "${updated.name}"`, id, updated.name);
  }

  return updated;
}

export function deleteProject(id: string): void {
  const project = getProjectOrThrow(id);
  deleteGenerationsForProject(id);
  deleteProjectInternal(id);
  logActivity('project.deleted', `Deleted project "${project.name}"`, null, project.name);
}

export function duplicateProject(id: string): Project {
  getProjectOrThrow(id);
  const copy = duplicateProjectInternal(id);
  if (!copy) throw AppError.notFound(`Project "${id}" not found`);
  logActivity('project.duplicated', `Duplicated as "${copy.name}"`, copy.id, copy.name);
  return copy;
}

export function recordGeneration(input: CreateGenerationInput): GenerationRecord {
  const project = getProjectOrThrow(input.projectId);
  const record = recordGenerationInternal(input);
  logActivity(
    'generation.logged',
    `Generation run logged for "${project.name}" (${record.status})`,
    project.id,
    project.name,
  );
  return record;
}

export function listGenerations(projectId?: string): GenerationRecord[] {
  return listGenerationRecords(projectId);
}

export function listActivity(projectId?: string, limit?: number): ActivityLogEntry[] {
  return listActivityEntries(projectId, limit);
}

export function getProjectDashboard(id: string): ProjectDashboard {
  const project = getProjectOrThrow(id);
  const generations = listGenerationRecords(id);
  const activity = listActivityEntries(id);
  return {
    project,
    generations,
    latestGeneration: generations[0] ?? null,
    activity,
    stats: {
      totalGenerations: generations.length,
      completedGenerations: generations.filter((g) => g.status === 'COMPLETED').length,
      failedGenerations: generations.filter((g) => g.status === 'FAILED').length,
    },
  };
}

export function runExport(request: ExportRequest): ExportResult {
  const project = request.projectId ? getProjectInternal(request.projectId) : undefined;
  const result = runExportInternal(request, project);
  logActivity(
    'export.completed',
    `Exported "${request.format}" for ${project?.name ?? request.artifacts.projectName}`,
    project?.id ?? null,
    project?.name ?? request.artifacts.projectName,
  );
  return result;
}

export function generateDocumentation(request: DocumentationRequest): DocumentationResult {
  const result = generateDocumentationInternal(request.type, request.artifacts);
  logActivity(
    'documentation.generated',
    `Generated ${request.type} documentation for ${request.artifacts.projectName}`,
    null,
    request.artifacts.projectName,
  );
  return result;
}

export function workspaceStatistics(): WorkspaceStatistics {
  const stats = projectStatistics();
  return {
    ...stats,
    totalGenerations: listGenerationRecords().length,
  };
}
