/**
 * Controllers for Phase 4. Bodies have already passed validation, so these
 * just narrow the request and hand off to the service. `/database/design`
 * returns the full bundle; `/openapi/generate` returns only the contract.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { designDatabase } from './database-designer.service.js';
import { readDesignRequest } from './database-designer.validator.js';

export function designDatabaseHandler(req: Request, res: Response): void {
  const { architecture, requirements } = readDesignRequest(req.body as Record<string, unknown>);
  const bundle = designDatabase(architecture, requirements);
  sendSuccess(res, bundle);
}

export function generateOpenApiHandler(req: Request, res: Response): void {
  const { architecture, requirements } = readDesignRequest(req.body as Record<string, unknown>);
  const bundle = designDatabase(architecture, requirements);
  sendSuccess(res, { openapi: bundle.openapi });
}
