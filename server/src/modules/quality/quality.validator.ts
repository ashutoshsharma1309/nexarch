/**
 * Input validation. `artifacts` only requires `projectName` — every
 * analyzer degrades gracefully when a pipeline stage hasn't run yet (same
 * shape-check-the-envelope approach as Workspace's and Deployment's
 * validators).
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { ExportFormat, ExportRequest, QualityArtifacts } from './quality.types.js';

const EXPORT_FORMATS: ExportFormat[] = [
  'quality-report',
  'testing-report',
  'benchmark-report',
  'engineering-score',
  'release-readiness',
  'readme',
  'documentation-package',
];

export const artifactsValidation: ValidationChain[] = [
  body('artifacts').isObject().withMessage('artifacts is required'),
  body('artifacts.projectName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('artifacts.projectName is required'),
];

export const exportValidation: ValidationChain[] = [
  body('format')
    .isIn(EXPORT_FORMATS)
    .withMessage(`format must be one of ${EXPORT_FORMATS.join(', ')}`),
  ...artifactsValidation,
];

export function readArtifacts(payload: Record<string, unknown>): QualityArtifacts {
  return payload.artifacts as QualityArtifacts;
}

export function readExportRequest(payload: Record<string, unknown>): ExportRequest {
  return {
    format: payload.format as ExportFormat,
    artifacts: payload.artifacts as QualityArtifacts,
  };
}
