/**
 * GET /projects/:projectId/executions                   — runs and enhancements.
 * GET /projects/:projectId/executions/:jobId/events     — `?after=<seq>` page.
 * GET /projects/:projectId/executions/:jobId/stream     — SSE, resumes from Last-Event-ID.
 * GET /projects/:projectId/executions/:jobId/usage      — per-stage consumption.
 * GET /projects/:projectId/runs/:runId/research         — the run's research artifact.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { createExecutionHandlers } from './execution-events.controller.js';

export const executionEventsRouter: Router = Router();

executionEventsRouter.use(requireAuth);

const handlers = createExecutionHandlers();

executionEventsRouter.get('/:projectId/executions', handlers.jobs);
executionEventsRouter.get('/:projectId/executions/:jobId/events', handlers.events);
executionEventsRouter.get('/:projectId/executions/:jobId/stream', handlers.stream);
executionEventsRouter.get('/:projectId/executions/:jobId/usage', handlers.usage);
executionEventsRouter.get('/:projectId/runs/:runId/research', handlers.research);
