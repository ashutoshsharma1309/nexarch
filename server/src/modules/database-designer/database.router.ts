/**
 * POST /api/v1/database/design
 *
 * Body: { architecture: ArchitecturePlan, requirements: RequirementSpec }
 * Returns the full DesignBundle (relational design, Prisma/SQL schemas, ER
 * diagram, OpenAPI contract, validation rules, entity metadata, integrity).
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { designDatabaseHandler } from './database-designer.controller.js';
import { designValidation } from './database-designer.validator.js';

import { requireAuth } from '../auth/index.js';

export const databaseRouter: Router = Router();

// Phase 16: every route here requires an authenticated session.
// These endpoints were reachable unauthenticated; a release build must
// not expose compute or data to anonymous callers.
databaseRouter.use(requireAuth);

databaseRouter.post('/design', validate(designValidation), designDatabaseHandler);
