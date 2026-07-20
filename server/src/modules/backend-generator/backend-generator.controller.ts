/**
 * Controller for Phase 5. The body has already passed validation, so this
 * just narrows the request and hands off to the service.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { generateBackend } from './backend-generator.service.js';
import { readGenerateRequest } from './backend-generator.validator.js';

export function generateBackendHandler(req: Request, res: Response): void {
  const {
    architecture,
    requirements,
    databaseDesign,
    prismaSchema,
    openapi,
    validationRules,
    entityMetadata,
  } = readGenerateRequest(req.body as Record<string, unknown>);

  const project = generateBackend(
    architecture,
    requirements,
    databaseDesign,
    prismaSchema,
    openapi,
    validationRules.entities,
    entityMetadata,
  );

  sendSuccess(res, project);
}
