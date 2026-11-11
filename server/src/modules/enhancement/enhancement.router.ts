/** HTTP for enhancements. Every route requires sign-in and is scoped to a project. */
import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import {
  applyHandler,
  cancelHandler,
  currentJobHandler,
  jobHandler,
  planHandler,
  revertHandler,
} from './enhancement.controller.js';

export const enhancementRouter: Router = Router();

enhancementRouter.use(requireAuth);

enhancementRouter.post('/:projectId/enhancements/plan', planHandler);
enhancementRouter.post('/:projectId/enhancements/:planId/apply', applyHandler);
enhancementRouter.get('/:projectId/enhancements/jobs/current', currentJobHandler);
enhancementRouter.get('/:projectId/enhancements/jobs/:jobId', jobHandler);
enhancementRouter.post('/:projectId/enhancements/jobs/:jobId/cancel', cancelHandler);
enhancementRouter.post('/:projectId/enhancements/jobs/:jobId/revert', revertHandler);
