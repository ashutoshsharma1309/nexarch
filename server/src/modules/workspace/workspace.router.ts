/**
 * Mounted at basePath `/` (see `index.ts`) so routes land at the literal
 * paths the Phase 10 spec lists — `/api/v1/projects`, `/api/v1/project/:id`,
 * `/api/v1/export`, `/api/v1/history` — instead of a shared module prefix
 * like every other module uses. The extra routes (PATCH/duplicate/
 * generations/statistics/documentation) cover the rest of the Project
 * Management and Documentation feature lists the spec enumerates beyond
 * its six literal examples.
 *
 * `requireAuth` is attached per-route rather than with `router.use()`, and
 * that is not a style choice: this router is mounted on the bare API prefix,
 * so router-level middleware would run for *every* `/api/v1/*` request on
 * its way to another module — including `/health` and `/auth/login`. Guards
 * belong on the routes they guard.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { requireAuth } from '../auth/index.js';
import {
  createGenerationHandler,
  createProjectHandler,
  deleteProjectHandler,
  documentationHandler,
  demoHandler,
  duplicateProjectHandler,
  exportHandler,
  exportProjectHandler,
  importProjectHandler,
  getProjectHandler,
  historyHandler,
  listProjectsHandler,
  projectRunsHandler,
  statisticsHandler,
  updateProjectHandler,
} from './workspace.controller.js';
import {
  createGenerationValidation,
  createProjectValidation,
  documentationValidation,
  exportValidation,
  historyValidation,
  listProjectsValidation,
  updateProjectValidation,
} from './workspace.validator.js';

export const workspaceRouter: Router = Router();

workspaceRouter.post(
  '/projects',
  requireAuth,
  validate(createProjectValidation),
  createProjectHandler,
);
workspaceRouter.get(
  '/projects',
  requireAuth,
  validate(listProjectsValidation),
  listProjectsHandler,
);
workspaceRouter.get('/project/:id', requireAuth, getProjectHandler);
workspaceRouter.patch(
  '/project/:id',
  requireAuth,
  validate(updateProjectValidation),
  updateProjectHandler,
);
workspaceRouter.delete('/project/:id', requireAuth, deleteProjectHandler);
workspaceRouter.post('/project/:id/duplicate', requireAuth, duplicateProjectHandler);
// Portability & demo (Phase 15). Import creates a new project, so it is
// rate limited like other expensive writes.
workspaceRouter.get('/project/:id/export', requireAuth, exportProjectHandler);
workspaceRouter.post('/projects/import', requireAuth, importProjectHandler);
workspaceRouter.post('/demo', requireAuth, demoHandler);
// Project → Run: the durable run history for one project.
workspaceRouter.get('/project/:id/runs', requireAuth, projectRunsHandler);
workspaceRouter.post(
  '/project/:id/generations',
  requireAuth,
  validate(createGenerationValidation),
  createGenerationHandler,
);

workspaceRouter.get('/history', requireAuth, validate(historyValidation), historyHandler);
workspaceRouter.get('/statistics', requireAuth, statisticsHandler);
workspaceRouter.post('/export', requireAuth, validate(exportValidation), exportHandler);
workspaceRouter.post(
  '/documentation',
  requireAuth,
  validate(documentationValidation),
  documentationHandler,
);
