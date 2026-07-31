/**
 * POST /api/v1/insights/generate — full architecture analysis for the
 * supplied pipeline artifacts: summary, justifications, explanations,
 * diagrams, and scores.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { generateInsightsHandler } from './insights.controller.js';
import { generateInsightsValidation } from './insights.validator.js';

export const insightsRouter: Router = Router();

insightsRouter.post('/generate', validate(generateInsightsValidation), generateInsightsHandler);
