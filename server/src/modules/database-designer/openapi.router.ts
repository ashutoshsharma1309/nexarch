/**
 * POST /api/v1/openapi/generate
 *
 * Body: { architecture: ArchitecturePlan, requirements: RequirementSpec }
 * Returns { openapi } — the OpenAPI 3.1 contract only. Shares the same
 * design pipeline as /database/design so the two can never disagree.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { generateOpenApiHandler } from './database-designer.controller.js';
import { designValidation } from './database-designer.validator.js';

import { requireAuth } from '../auth/index.js';

export const openapiRouter: Router = Router();

// Phase 16: authenticated callers only.
openapiRouter.use(requireAuth);

openapiRouter.post('/generate', validate(designValidation), generateOpenApiHandler);
