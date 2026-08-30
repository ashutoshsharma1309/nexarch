/**
 * Thin controllers — narrow the request, call the service, send the
 * envelope. `GET /project/:id` returns the full `ProjectDashboard`
 * (project + generation history + activity + stats) since that is exactly
 * what the Project Dashboard screen needs in one round trip.
 *
 * Every project handler reads its owner from `req.user`, which the module's
 * `requireAuth` guard guarantees. Ownership is a query filter, not a
 * post-hoc check: a project belonging to someone else is never loaded in
 * the first place.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import {
  createProject as createProjectSvc,
  createOrResetDemo,
  exportProject,
  importProject,
  deleteProject as deleteProjectSvc,
  duplicateProject as duplicateProjectSvc,
  generateDocumentation as generateDocumentationSvc,
  getProjectDashboard,
  listActivity,
  listGenerations,
  listProjectRuns as listProjectRunsSvc,
  listProjects as listProjectsSvc,
  recordGeneration as recordGenerationSvc,
  runExport as runExportSvc,
  updateProject as updateProjectSvc,
  workspaceStatistics,
} from './workspace.service.js';
import {
  readCreateGenerationRequest,
  readCreateProjectRequest,
  readDocumentationRequest,
  readExportRequest,
  readListProjectsQuery,
  readUpdateProjectRequest,
} from './workspace.validator.js';

/**
 * The owner of the request. `requireAuth` runs before every handler that
 * calls this, so a missing user is a wiring mistake rather than an
 * unauthenticated caller — hence a thrown error, not a 401.
 */
function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

export async function createProjectHandler(req: Request, res: Response): Promise<void> {
  const input = readCreateProjectRequest(req.body as Record<string, unknown>);
  const project = await createProjectSvc(ownerOf(req), input);
  sendSuccess(res, project, { status: 201 });
}

export async function exportProjectHandler(req: Request, res: Response): Promise<void> {
  const pkg = await exportProject(ownerOf(req), req.params.id as string);
  sendSuccess(res, pkg);
}

export async function importProjectHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { package?: unknown };
  const result = await importProject(ownerOf(req), body.package ?? req.body);
  sendSuccess(
    res,
    {
      project: result.project,
      imported: {
        artifacts: result.imported.artifactsSeeded,
        findings: result.imported.findingsSeeded,
        graph: result.imported.graphSynced,
      },
    },
    { status: 201 },
  );
}

export async function demoHandler(req: Request, res: Response): Promise<void> {
  const result = await createOrResetDemo(ownerOf(req));
  sendSuccess(res, { project: result.project, seeded: result.seeded }, { status: 201 });
}

export async function listProjectsHandler(req: Request, res: Response): Promise<void> {
  const query = readListProjectsQuery(req.query);
  sendSuccess(res, await listProjectsSvc(ownerOf(req), query));
}

export async function getProjectHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getProjectDashboard(ownerOf(req), req.params.id as string));
}

export async function updateProjectHandler(req: Request, res: Response): Promise<void> {
  const input = readUpdateProjectRequest(req.body as Record<string, unknown>);
  sendSuccess(res, await updateProjectSvc(ownerOf(req), req.params.id as string, input));
}

export async function deleteProjectHandler(req: Request, res: Response): Promise<void> {
  await deleteProjectSvc(ownerOf(req), req.params.id as string);
  sendSuccess(res, { id: req.params.id as string, deleted: true });
}

export async function duplicateProjectHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await duplicateProjectSvc(ownerOf(req), req.params.id as string), {
    status: 201,
  });
}

export async function createGenerationHandler(req: Request, res: Response): Promise<void> {
  const input = readCreateGenerationRequest(
    req.params.id as string,
    req.body as Record<string, unknown>,
  );
  sendSuccess(res, await recordGenerationSvc(ownerOf(req), input), { status: 201 });
}

export async function historyHandler(req: Request, res: Response): Promise<void> {
  const ownerId = ownerOf(req);
  const projectId = req.query.projectId as string | undefined;
  const limit = (req.query.limit as unknown as number | undefined) ?? 50;

  // Generation and activity history live in process-global logs. They must be
  // scoped to the caller's own projects: with only auth added, an authed user
  // could still pass any projectId (or none) and read another tenant's feed.
  const owned = new Set((await listProjectsSvc(ownerId, {})).map((project) => project.id));
  if (projectId !== undefined && !owned.has(projectId)) {
    throw AppError.notFound(`Project "${projectId}" not found`);
  }
  const inScope = (id: string | null): boolean =>
    id !== null && (projectId !== undefined ? id === projectId : owned.has(id));

  sendSuccess(res, {
    generations: listGenerations().filter((record) => inScope(record.projectId)),
    activity: listActivity(undefined, Number.MAX_SAFE_INTEGER)
      .filter((entry) => inScope(entry.projectId))
      .slice(0, limit),
  });
}

export async function projectRunsHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listProjectRunsSvc(ownerOf(req), req.params.id as string));
}

export async function statisticsHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await workspaceStatistics(ownerOf(req)));
}

export async function exportHandler(req: Request, res: Response): Promise<void> {
  const request = readExportRequest(req.body as Record<string, unknown>);
  sendSuccess(res, await runExportSvc(ownerOf(req), request));
}

export function documentationHandler(req: Request, res: Response): void {
  const request = readDocumentationRequest(req.body as Record<string, unknown>);
  sendSuccess(res, generateDocumentationSvc(request));
}
