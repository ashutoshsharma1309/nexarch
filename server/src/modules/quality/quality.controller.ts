/**
 * `POST /quality/analyze` computes the full engineering bundle and caches
 * it (same "most recent build in this process" continuity model as the
 * Dependency Graph's `lastBuild`) so the three `GET` endpoints can serve
 * without a request body.
 */
import type { Request, Response } from 'express';

import { AppError } from '../../shared/utils/app-error.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { analyzeQuality, generateDocumentation, runExport, runTesting } from './quality.service.js';
import type { EngineeringBundle } from './quality.types.js';
import { readArtifacts, readExportRequest } from './quality.validator.js';

let lastBundle: EngineeringBundle | null = null;

export function analyzeHandler(req: Request, res: Response): void {
  const artifacts = readArtifacts(req.body as Record<string, unknown>);
  const bundle = analyzeQuality(artifacts);
  lastBundle = bundle;
  sendSuccess(res, bundle);
}

export function testingHandler(req: Request, res: Response): void {
  const artifacts = readArtifacts(req.body as Record<string, unknown>);
  sendSuccess(res, runTesting(artifacts));
}

export function documentationHandler(req: Request, res: Response): void {
  const artifacts = readArtifacts(req.body as Record<string, unknown>);
  sendSuccess(res, generateDocumentation(artifacts));
}

export function exportHandler(req: Request, res: Response): void {
  const request = readExportRequest(req.body as Record<string, unknown>);
  sendSuccess(res, runExport(request));
}

export function qualityReportHandler(_req: Request, res: Response): void {
  if (!lastBundle) {
    throw AppError.notFound('No quality analysis has run yet — call POST /quality/analyze first');
  }
  sendSuccess(res, lastBundle.quality);
}

export function performanceReportHandler(_req: Request, res: Response): void {
  if (!lastBundle) {
    throw AppError.notFound('No quality analysis has run yet — call POST /quality/analyze first');
  }
  sendSuccess(res, lastBundle.performance);
}

export function releaseReadinessHandler(_req: Request, res: Response): void {
  if (!lastBundle) {
    throw AppError.notFound('No quality analysis has run yet — call POST /quality/analyze first');
  }
  sendSuccess(res, lastBundle.readiness);
}
