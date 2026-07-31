/**
 * Input validation. The three structured stages are required — there is no
 * meaningful analysis without requirements, plan, and database design —
 * validated as envelopes only; the service trusts their internal shape the
 * same way every downstream generator does.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { GenerateInsightsRequest, InsightsArtifacts } from './insights.types.js';

export const generateInsightsValidation: ValidationChain[] = [
  body('artifacts').isObject().withMessage('artifacts is required'),
  body('artifacts.projectName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('artifacts.projectName is required'),
  body('artifacts.requirements').isObject().withMessage('artifacts.requirements is required'),
  body('artifacts.architecture').isObject().withMessage('artifacts.architecture is required'),
  body('artifacts.databaseDesign').isObject().withMessage('artifacts.databaseDesign is required'),
  body('artifacts.quality')
    .optional()
    .isObject()
    .withMessage('artifacts.quality must be an object'),
];

export function readGenerateInsightsRequest(
  payload: Record<string, unknown>,
): GenerateInsightsRequest {
  return { artifacts: payload.artifacts as InsightsArtifacts };
}
