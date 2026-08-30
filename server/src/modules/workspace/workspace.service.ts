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
import { exportProjectPackage, importIntoProject } from './lib/project-portability.js';
import { validatePackage } from './lib/project-package.js';
import { seedDemoProject, DEMO_PROJECT_NAME, DEMO_PROMPT } from './lib/demo-project.js';
import { listRunsForProject } from '../pipeline/lib/run-store.js';
import type { ProjectPackage } from './lib/project-package.js';
import type { ImportResult } from './lib/project-portability.js';
import type { Run } from '../../shared/contracts/project.js';
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

export async function createProject(ownerId: string, input: CreateProjectInput): Promise<Project> {
  const project = await createProjectInternal(ownerId, input);
  logActivity('project.created', `Created project "${project.name}"`, project.id, project.name);
  return project;
}

export async function listProjects(ownerId: string, query: ListProjectsQuery): Promise<Project[]> {
  return listProjectsInternal(ownerId, query);
}

/** Not-found and not-yours are the same answer on purpose — a 404 must not confirm that another user's project id exists. */
export async function getProjectOrThrow(ownerId: string, id: string): Promise<Project> {
  const project = await getProjectInternal(ownerId, id);
  if (!project) throw AppError.notFound(`Project "${id}" not found`);
  return project;
}

export async function updateProject(
  ownerId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const before = await getProjectOrThrow(ownerId, id);
  const updated = await updateProjectInternal(ownerId, id, input);
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

export async function deleteProject(ownerId: string, id: string): Promise<void> {
  const project = await getProjectOrThrow(ownerId, id);
  deleteGenerationsForProject(id);
  await deleteProjectInternal(ownerId, id);
  logActivity('project.deleted', `Deleted project "${project.name}"`, null, project.name);
}

export async function duplicateProject(ownerId: string, id: string): Promise<Project> {
  await getProjectOrThrow(ownerId, id);
  const copy = await duplicateProjectInternal(ownerId, id);
  if (!copy) throw AppError.notFound(`Project "${id}" not found`);
  logActivity('project.duplicated', `Duplicated as "${copy.name}"`, copy.id, copy.name);
  return copy;
}

export async function recordGeneration(
  ownerId: string,
  input: CreateGenerationInput,
): Promise<GenerationRecord> {
  const project = await getProjectOrThrow(ownerId, input.projectId);
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

export async function getProjectDashboard(ownerId: string, id: string): Promise<ProjectDashboard> {
  const project = await getProjectOrThrow(ownerId, id);
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

export async function runExport(ownerId: string, request: ExportRequest): Promise<ExportResult> {
  const project = request.projectId
    ? await getProjectInternal(ownerId, request.projectId)
    : undefined;
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

export async function workspaceStatistics(ownerId: string): Promise<WorkspaceStatistics> {
  const stats = await projectStatistics(ownerId);
  return {
    ...stats,
    totalGenerations: listGenerationRecords().length,
  };
}

/**
 * Every run of one project, newest first — the read side of Project → Run.
 * Reads the durable `generations` record rather than the pipeline's
 * in-memory run map, so history survives a restart and a run that this
 * process never executed still appears.
 */
export async function listProjectRuns(ownerId: string, projectId: string): Promise<Run[]> {
  // Ownership first: this resolves to 404 for someone else's project id.
  await getProjectOrThrow(ownerId, projectId);
  // The generation log is owned by the pipeline run-store, which serves it
  // from MySQL or from memory depending on config — read through it so both
  // modes agree rather than re-querying the table here.
  return listRunsForProject(projectId, 50);
}

/* ── Project portability & demo (Phase 15) ────────────────────────────── */

/** Exports a project the caller owns as a portable, secret-free package. */
export async function exportProject(ownerId: string, projectId: string): Promise<ProjectPackage> {
  const project = await getProjectOrThrow(ownerId, projectId);
  const kind = project.name === DEMO_PROJECT_NAME ? 'demo' : 'project';
  return exportProjectPackage(projectId, project.name, project.description ?? null, kind);
}

/**
 * Imports a package into a brand-new project owned by the caller.
 *
 * A new project is created first (new id, this owner), then seeded — so an
 * import can never adopt another project's identity or ownership.
 */
export async function importProject(
  ownerId: string,
  rawPackage: unknown,
): Promise<{ project: Project; imported: ImportResult }> {
  const validated = validatePackage(rawPackage);
  const project = await createProject(ownerId, {
    name: `${validated.project.name} (imported)`.slice(0, 120),
    description: validated.project.description ?? undefined,
  });
  const imported = await importIntoProject(project.id, validated);
  logActivity('project.imported', `Imported "${project.name}"`, project.id, project.name);
  return { project, imported };
}

/**
 * Creates or resets the caller's demo project (Steps 13–18).
 *
 * The demo is a real, deterministic project the user owns, named so it can
 * never be confused with their own work. Reset re-seeds the same project;
 * a brand-new demo is created only when the user has none.
 */
export async function createOrResetDemo(
  ownerId: string,
): Promise<{ project: Project; seeded: Awaited<ReturnType<typeof seedDemoProject>> }> {
  const existing = (await listProjectsInternal(ownerId, {})).find(
    (candidate) => candidate.name === DEMO_PROJECT_NAME,
  );
  const project =
    existing ??
    (await createProject(ownerId, { name: DEMO_PROJECT_NAME, description: DEMO_PROMPT }));
  const seeded = await seedDemoProject(project.id);
  logActivity(
    'demo.reset',
    `Demo project ${existing ? 'reset' : 'created'}`,
    project.id,
    project.name,
  );
  return { project, seeded };
}
