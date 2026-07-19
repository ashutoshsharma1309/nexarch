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

export const architectureRouter: Router = Router();

architectureRouter.post('/', validate(architectureValidation), planArchitectureHandler);
