import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { generateInsights } from './insights.service.js';
import { readGenerateInsightsRequest } from './insights.validator.js';

export function generateInsightsHandler(req: Request, res: Response): void {
  const request = readGenerateInsightsRequest(req.body as Record<string, unknown>);
  sendSuccess(res, generateInsights(request));
}
