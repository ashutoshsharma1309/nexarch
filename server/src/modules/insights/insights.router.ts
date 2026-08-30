/**
 * POST /api/v1/insights/generate — full architecture analysis for the
 * supplied pipeline artifacts: summary, justifications, explanations,
 * diagrams, and scores.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import { generateInsightsHandler } from './insights.controller.js';
import { generateInsightsValidation } from './insights.validator.js';

import { requireAuth } from '../auth/index.js';

export const insightsRouter: Router = Router();

// Phase 16: every route here requires an authenticated session.
// These endpoints were reachable unauthenticated; a release build must
// not expose compute or data to anonymous callers.
insightsRouter.use(requireAuth);

insightsRouter.post('/generate', validate(generateInsightsValidation), generateInsightsHandler);
