/**
 * POST /api/v1/security/analyze
 *
 * Body: { requirements, architecture, databaseDesign, openapi,
 *         backendManifest, entityMetadata?, frontendManifest? } — the
 * artifacts from Phases 2-6. Returns a SecurityAnalysis: the audit and
 * OWASP report, without generating any files.
 *
 * POST /api/v1/security/apply
 *
 * Same body. Returns a SecurityBundle: the same audit plus every backend/
 * frontend file the engine generates to close what it can close, RBAC/
 * password/file-security config, and the folder tree.
 *
 * GET /api/v1/security/report
 *
 * Returns the most recently generated report (404 if analyze/apply hasn't
 * run yet in this process).
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { analyzeHandler, applyHandler, reportHandler } from './security-engine.controller.js';
import { securityValidation } from './security-engine.validator.js';

export const securityEngineRouter: Router = Router();

securityEngineRouter.post('/analyze', validate(securityValidation), analyzeHandler);
securityEngineRouter.post('/apply', validate(securityValidation), applyHandler);
securityEngineRouter.get('/report', reportHandler);
