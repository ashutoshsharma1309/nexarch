/**
 * Thin controllers — narrow the request, call the service, send the
 * envelope. `GET /project/:id` returns the full `ProjectDashboard`
 * (project + generation history + activity + stats) since that is exactly
 * what the Project Dashboard screen needs in one round trip.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  createProject as createProjectSvc,
  deleteProject as deleteProjectSvc,
  duplicateProject as duplicateProjectSvc,
  generateDocumentation as generateDocumentationSvc,
  getProjectDashboard,
  listActivity,
  listGenerations,
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

export function createProjectHandler(req: Request, res: Response): void {
  const input = readCreateProjectRequest(req.body as Record<string, unknown>);
  const project = createProjectSvc(input);
  sendSuccess(res, project, { status: 201 });
}

export function listProjectsHandler(req: Request, res: Response): void {
  const query = readListProjectsQuery(req.query);
  sendSuccess(res, listProjectsSvc(query));
}

export function getProjectHandler(req: Request, res: Response): void {
  sendSuccess(res, getProjectDashboard(req.params.id as string));
}

export function updateProjectHandler(req: Request, res: Response): void {
  const input = readUpdateProjectRequest(req.body as Record<string, unknown>);
  sendSuccess(res, updateProjectSvc(req.params.id as string, input));
}

export function deleteProjectHandler(req: Request, res: Response): void {
  deleteProjectSvc(req.params.id as string);
  sendSuccess(res, { id: req.params.id as string, deleted: true });
}

export function duplicateProjectHandler(req: Request, res: Response): void {
  sendSuccess(res, duplicateProjectSvc(req.params.id as string), { status: 201 });
}

export function createGenerationHandler(req: Request, res: Response): void {
  const input = readCreateGenerationRequest(
    req.params.id as string,
    req.body as Record<string, unknown>,
  );
  sendSuccess(res, recordGenerationSvc(input), { status: 201 });
}

export function historyHandler(req: Request, res: Response): void {
  const projectId = req.query.projectId as string | undefined;
  const limit = req.query.limit as unknown as number | undefined;
  sendSuccess(res, {
    generations: listGenerations(projectId),
    activity: listActivity(projectId, limit),
  });
}

export function statisticsHandler(_req: Request, res: Response): void {
  sendSuccess(res, workspaceStatistics());
}

export function exportHandler(req: Request, res: Response): void {
  const request = readExportRequest(req.body as Record<string, unknown>);
  sendSuccess(res, runExportSvc(request));
}

export function documentationHandler(req: Request, res: Response): void {
  const request = readDocumentationRequest(req.body as Record<string, unknown>);
  sendSuccess(res, generateDocumentationSvc(request));
}
