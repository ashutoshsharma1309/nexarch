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

export const databaseRouter: Router = Router();

databaseRouter.post('/design', validate(designValidation), designDatabaseHandler);
