/**
 * POST /api/v1/architecture
 *
 * Body: a RequirementSpec (the Requirement Analyzer's COMPLETE output).
 * Responds with { plan, markdown } in the standard envelope; malformed or
 * incomplete specs get 422 with field-level details.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { planArchitectureHandler } from './architecture.controller.js';
import { architectureValidation } from './architecture.validator.js';

import { requireAuth } from '../auth/index.js';

export const architectureRouter: Router = Router();

// Phase 16: every route here requires an authenticated session.
// These endpoints were reachable unauthenticated; a release build must
// not expose compute or data to anonymous callers.
architectureRouter.use(requireAuth);

architectureRouter.post('/', validate(architectureValidation), planArchitectureHandler);
