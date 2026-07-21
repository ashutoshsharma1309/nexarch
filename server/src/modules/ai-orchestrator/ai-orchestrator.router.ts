/**
 * POST /api/v1/ai/generate
 *
 * Body: { promptId, variables, complexity, context?, schema? }. Renders
 * the named prompt template, routes to a model by task complexity, checks
 * the response cache, calls the provider (retrying network/timeout/
 * invalid-JSON/malformed/rate-limit failures with backoff), validates the
 * response, and records it to generation history. Returns a
 * GenerateResponse.
 *
 * POST /api/v1/ai/retry
 *
 * Same body — re-runs the same pipeline bypassing the cache.
 *
 * POST /api/v1/ai/workflow
 *
 * Body: { workflowId, steps: [{ name, variables?, context?, completed? }] }.
 * Runs (a subset of) a named workflow's steps in order. Returns a
 * WorkflowRun.
 *
 * GET /api/v1/ai/history?limit=&id=
 *
 * Returns generation history (most recent first), or a single record by id.
 *
 * GET /api/v1/ai/statistics
 *
 * Returns cost/token/cache analytics across all recorded generations.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  generateHandler,
  historyHandler,
  retryHandler,
  statisticsHandler,
  workflowHandler,
} from './ai-orchestrator.controller.js';
import { generateValidation, workflowValidation } from './ai-orchestrator.validator.js';

export const aiOrchestratorRouter: Router = Router();

aiOrchestratorRouter.post('/generate', validate(generateValidation), generateHandler);
aiOrchestratorRouter.post('/retry', validate(generateValidation), retryHandler);
aiOrchestratorRouter.post('/workflow', validate(workflowValidation), workflowHandler);
aiOrchestratorRouter.get('/history', historyHandler);
aiOrchestratorRouter.get('/statistics', statisticsHandler);
