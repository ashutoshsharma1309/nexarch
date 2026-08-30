/**
 * POST /api/v1/backend/generate
 *
 * Body: { architecture, requirements, databaseDesign, prismaSchema, openapi,
 *         validationRules?, entityMetadata? } — the artifacts from Phases
 * 2–4. Returns a GeneratedProject: an in-memory Express + TypeScript +
 * Prisma backend (files, module summaries, routes, folder tree, stats).
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { generateBackendHandler } from './backend-generator.controller.js';
import { generateValidation } from './backend-generator.validator.js';

import { requireAuth } from '../auth/index.js';

export const backendGeneratorRouter: Router = Router();

// Phase 16: every route here requires an authenticated session.
// These endpoints were reachable unauthenticated; a release build must
// not expose compute or data to anonymous callers.
backendGeneratorRouter.use(requireAuth);

backendGeneratorRouter.post('/generate', validate(generateValidation), generateBackendHandler);
