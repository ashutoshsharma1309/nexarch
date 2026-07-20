/**
 * Controller for Phase 6. The body has already passed validation, so this
 * just narrows the request and hands off to the service.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { generateFrontend } from './frontend-generator.service.js';
import { readGenerateRequest } from './frontend-generator.validator.js';

export function generateFrontendHandler(req: Request, res: Response): void {
  const { architecture, requirements, databaseDesign, openapi, backendManifest, entityMetadata } =
    readGenerateRequest(req.body as Record<string, unknown>);

  const project = generateFrontend(
    architecture,
    requirements,
    databaseDesign,
    openapi,
    backendManifest,
    entityMetadata,
  );

  sendSuccess(res, project);
}
