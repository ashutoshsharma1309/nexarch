/**
 * POST /api/v1/deployment/generate — full DeploymentBundle for a target.
 * POST /api/v1/deployment/export — one export format, file or archive.
 * GET  /api/v1/deployment/status — supported targets and capabilities.
 * GET  /api/v1/deployment/health — preview of the generated health-check
 * surface (not a live check — this module never deploys anything itself).
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  exportHandler,
  generateHandler,
  healthHandler,
  statusHandler,
} from './deployment.controller.js';
import { exportValidation, generateValidation } from './deployment.validator.js';

export const deploymentRouter: Router = Router();

deploymentRouter.post('/generate', validate(generateValidation), generateHandler);
deploymentRouter.post('/export', validate(exportValidation), exportHandler);
deploymentRouter.get('/status', statusHandler);
deploymentRouter.get('/health', healthHandler);
