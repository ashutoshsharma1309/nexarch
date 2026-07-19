/**
 * ArchitectureController: HTTP translation only — the request body has
 * already passed validation, so normalize it and hand it to the service.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { planArchitecture } from './architecture.service.js';
import { normalizeSpec } from './architecture.validator.js';

export function planArchitectureHandler(req: Request, res: Response): void {
  const spec = normalizeSpec(req.body as Record<string, unknown>);
  const result = planArchitecture(spec);
  sendSuccess(res, result);
}
