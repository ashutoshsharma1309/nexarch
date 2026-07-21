/**
 * Controller. `generate`/`retry`/`workflow` bodies have already passed
 * validation, so this just narrows the request and hands off to the
 * service; `history`/`statistics` read straight from the in-memory
 * generation history.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  executeWorkflow,
  generate,
  getGenerationById,
  getHistory,
  getStatistics,
  retry,
} from './ai-orchestrator.service.js';
import { readGenerateRequest, readWorkflowRequest } from './ai-orchestrator.validator.js';

export async function generateHandler(req: Request, res: Response): Promise<void> {
  const request = readGenerateRequest(req.body as Record<string, unknown>);
  const response = await generate(request);
  sendSuccess(res, response);
}

export async function retryHandler(req: Request, res: Response): Promise<void> {
  const request = readGenerateRequest(req.body as Record<string, unknown>);
  const response = await retry(request);
  sendSuccess(res, response);
}

export async function workflowHandler(req: Request, res: Response): Promise<void> {
  const { workflowId, steps } = readWorkflowRequest(req.body as Record<string, unknown>);
  const run = await executeWorkflow(workflowId, steps);
  sendSuccess(res, run);
}

export function historyHandler(req: Request, res: Response): void {
  const limitParam = req.query.limit;
  const limit = typeof limitParam === 'string' ? Number.parseInt(limitParam, 10) : undefined;

  const idParam = req.query.id;
  if (typeof idParam === 'string') {
    sendSuccess(res, getGenerationById(idParam));
    return;
  }

  sendSuccess(res, getHistory(limit && Number.isFinite(limit) ? limit : undefined));
}

export function statisticsHandler(_req: Request, res: Response): void {
  sendSuccess(res, getStatistics());
}
