/**
 * POST /api/v1/frontend/generate
 *
 * Body: { architecture, requirements, databaseDesign, openapi,
 *         backendManifest, entityMetadata? } — the artifacts from Phases
 * 2–5. Returns a GeneratedFrontend: an in-memory React 19 + Vite +
 * TypeScript project (files, page/component/route/store summaries, folder
 * tree, stats).
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { generateFrontendHandler } from './frontend-generator.controller.js';
import { generateValidation } from './frontend-generator.validator.js';

export const frontendGeneratorRouter: Router = Router();

frontendGeneratorRouter.post('/generate', validate(generateValidation), generateFrontendHandler);
