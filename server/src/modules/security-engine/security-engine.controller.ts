/**
 * Controller for Phase 7. `analyze`/`apply` bodies have already passed
 * validation, so this just narrows the request and hands off to the
 * service. `GET /report` has no body to validate — it serves the most
 * recently generated report from an in-memory cache (this platform has no
 * persistence layer; every other generator is likewise a pure request/
 * response pipeline, so "most recent in this process" is the same
 * continuity model the rest of the API already relies on).
 */
import type { Request, Response } from 'express';

import { AppError } from '../../shared/utils/app-error.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { analyzeSecurity, applySecurity } from './security-engine.service.js';
import { readSecurityRequest } from './security-engine.validator.js';
import type { SecurityReport } from './security-engine.types.js';

let lastReport: SecurityReport | null = null;

export function analyzeHandler(req: Request, res: Response): void {
  const inputs = readSecurityRequest(req.body as Record<string, unknown>);
  const analysis = analyzeSecurity(inputs);
  lastReport = analysis.report;
  sendSuccess(res, analysis);
}

export function applyHandler(req: Request, res: Response): void {
  const inputs = readSecurityRequest(req.body as Record<string, unknown>);
  const bundle = applySecurity(inputs);
  lastReport = bundle.report;
  sendSuccess(res, bundle);
}

export function reportHandler(_req: Request, res: Response): void {
  if (!lastReport) {
    throw AppError.notFound(
      'No security report has been generated yet — call POST /security/analyze or /security/apply first',
    );
  }
  sendSuccess(res, lastReport);
}
