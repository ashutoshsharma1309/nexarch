/**
 * POST /api/v1/analyze
 *
 * Body: { "prompt": "Build an ecommerce website with JWT auth" }
 * Responds with the standard envelope; `data` is an AnalysisResult —
 * either a COMPLETE RequirementSpec or an INCOMPLETE set of clarifying
 * questions. Validation failures return 422 with field-level details.
 */
import { Router } from 'express';
import { body } from 'express-validator';

import { validate } from '../../shared/middleware/validate.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { analyzeRequirements } from './analysis.service.js';

const MIN_PROMPT_LENGTH = 10;
const MAX_PROMPT_LENGTH = 4000;

const analyzeValidation = [
  body('prompt')
    .exists({ values: 'falsy' })
    .withMessage('prompt is required')
    .bail()
    .isString()
    .withMessage('prompt must be a string')
    .bail()
    .trim()
    .isLength({ min: MIN_PROMPT_LENGTH })
    .withMessage(
      `prompt is too short — describe the application in at least ${MIN_PROMPT_LENGTH} characters`,
    )
    .isLength({ max: MAX_PROMPT_LENGTH })
    .withMessage(`prompt is too long — keep it under ${MAX_PROMPT_LENGTH} characters`),
];

export const analysisRouter: Router = Router();

analysisRouter.post('/', validate(analyzeValidation), (req, res) => {
  const { prompt } = req.body as { prompt: string };
  const result = analyzeRequirements(prompt);
  sendSuccess(res, result);
});
