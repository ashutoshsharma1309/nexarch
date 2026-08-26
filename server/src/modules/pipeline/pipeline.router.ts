/**
 * POST /api/v1/pipeline/runs            — 202 + the new run; stages advance server-side.
 * GET  /api/v1/pipeline/runs            — every run this process holds, newest first.
 * GET  /api/v1/pipeline/runs/:id        — one run with live per-stage state.
 * GET  /api/v1/pipeline/runs/:id/artifacts — everything the run produced.
 * POST /api/v1/pipeline/runs/:id/retry  — 202; re-runs the same prompt as a new run.
 *
 * Generating a project is the platform's expensive operation and it writes
 * to a user's workspace, so the whole subtree sits behind `requireAuth`.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { requireAuth } from '../auth/index.js';
import {
  artifactsHandler,
  getRunHandler,
  listRunsHandler,
  retryRunHandler,
  startRunHandler,
} from './pipeline.controller.js';
import { startRunValidation } from './pipeline.validator.js';

export const pipelineRouter: Router = Router();

pipelineRouter.use(requireAuth);

pipelineRouter.post('/runs', validate(startRunValidation), startRunHandler);
pipelineRouter.get('/runs', listRunsHandler);
pipelineRouter.get('/runs/:id', getRunHandler);
pipelineRouter.get('/runs/:id/artifacts', artifactsHandler);
pipelineRouter.post('/runs/:id/retry', retryRunHandler);
