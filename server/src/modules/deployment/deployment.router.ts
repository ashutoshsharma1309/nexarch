/**
 * POST /api/v1/deployment/generate — full DeploymentBundle for a target.
 * POST /api/v1/deployment/export — one export format, file or archive.
 * GET  /api/v1/deployment/status — supported targets and capabilities.
 * GET  /api/v1/deployment/health — preview of the generated health-check
 * surface (not a live check).
 *
 * One-click deploy execution (Phase 13) — the part that DOES deploy:
 * GET  /api/v1/deployment/providers — provider registry with configured state.
 * POST /api/v1/deployment/execute/plan — dry-run (works with no tokens).
 * POST /api/v1/deployment/execute — 202 + execution record; the provider
 * adapter drives the queued→building→deploying→monitoring→live|failed
 * state machine while the client polls the execution.
 * GET  /api/v1/deployment/executions — recent executions, newest first.
 * GET  /api/v1/deployment/executions/:id — one execution with transitions.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  executeHandler,
  executePlanHandler,
  executionHandler,
  executionsHandler,
  exportHandler,
  generateHandler,
  healthHandler,
  providersHandler,
  statusHandler,
} from './deployment.controller.js';
import {
  executeDeployValidation,
  exportValidation,
  generateValidation,
} from './deployment.validator.js';

import { requireAuth } from '../auth/index.js';

export const deploymentRouter: Router = Router();

// Phase 16: every route here requires an authenticated session.
// These endpoints were reachable unauthenticated; a release build must
// not expose compute or data to anonymous callers.
deploymentRouter.use(requireAuth);

deploymentRouter.post('/generate', validate(generateValidation), generateHandler);
deploymentRouter.post('/export', validate(exportValidation), exportHandler);
deploymentRouter.get('/status', statusHandler);
deploymentRouter.get('/health', healthHandler);
deploymentRouter.get('/providers', providersHandler);
deploymentRouter.post('/execute/plan', validate(executeDeployValidation), executePlanHandler);
deploymentRouter.post('/execute', validate(executeDeployValidation), executeHandler);
deploymentRouter.get('/executions', executionsHandler);
deploymentRouter.get('/executions/:id', executionHandler);
