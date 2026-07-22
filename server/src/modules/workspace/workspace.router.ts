/**
 * Mounted at basePath `/` (see `index.ts`) so routes land at the literal
 * paths the Phase 10 spec lists — `/api/v1/projects`, `/api/v1/project/:id`,
 * `/api/v1/export`, `/api/v1/history` — instead of a shared module prefix
 * like every other module uses. The extra routes (PATCH/duplicate/
 * generations/statistics/documentation) cover the rest of the Project
 * Management and Documentation feature lists the spec enumerates beyond
 * its six literal examples.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  createGenerationHandler,
  createProjectHandler,
  deleteProjectHandler,
  documentationHandler,
  duplicateProjectHandler,
  exportHandler,
  getProjectHandler,
  historyHandler,
  listProjectsHandler,
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

workspaceRouter.post('/projects', validate(createProjectValidation), createProjectHandler);
workspaceRouter.get('/projects', validate(listProjectsValidation), listProjectsHandler);
workspaceRouter.get('/project/:id', getProjectHandler);
workspaceRouter.patch('/project/:id', validate(updateProjectValidation), updateProjectHandler);
workspaceRouter.delete('/project/:id', deleteProjectHandler);
workspaceRouter.post('/project/:id/duplicate', duplicateProjectHandler);
workspaceRouter.post(
  '/project/:id/generations',
  validate(createGenerationValidation),
  createGenerationHandler,
);

workspaceRouter.get('/history', validate(historyValidation), historyHandler);
workspaceRouter.get('/statistics', statisticsHandler);
workspaceRouter.post('/export', validate(exportValidation), exportHandler);
workspaceRouter.post('/documentation', validate(documentationValidation), documentationHandler);
