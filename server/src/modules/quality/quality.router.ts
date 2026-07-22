/**
 * POST /api/v1/quality/analyze — full engineering bundle for a project.
 * POST /api/v1/testing/run — generated test suite + coverage estimate.
 * POST /api/v1/documentation/generate — the 10-document package.
 * POST /api/v1/quality/export — one export format, file or archive.
 * GET  /api/v1/quality/report — cached quality report from the last analyze.
 * GET  /api/v1/performance/report — cached performance report.
 * GET  /api/v1/release/readiness — cached release readiness.
 *
 * Mounted at basePath `/` (like Workspace) so routes land at the literal
 * `/quality/...`, `/testing/...`, `/documentation/...`, `/performance/...`,
 * `/release/...` paths the spec calls out, rather than one shared prefix.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  analyzeHandler,
  documentationHandler,
  exportHandler,
  performanceReportHandler,
  qualityReportHandler,
  releaseReadinessHandler,
  testingHandler,
} from './quality.controller.js';
import { artifactsValidation, exportValidation } from './quality.validator.js';

export const qualityRouter: Router = Router();

qualityRouter.post('/quality/analyze', validate(artifactsValidation), analyzeHandler);
qualityRouter.post('/quality/export', validate(exportValidation), exportHandler);
qualityRouter.get('/quality/report', qualityReportHandler);
qualityRouter.post('/testing/run', validate(artifactsValidation), testingHandler);
qualityRouter.post('/documentation/generate', validate(artifactsValidation), documentationHandler);
qualityRouter.get('/performance/report', performanceReportHandler);
qualityRouter.get('/release/readiness', releaseReadinessHandler);
