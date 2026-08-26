/**
 * HTTP translation for the pipeline. The run object is small and polled;
 * the artifact bundle is large and fetched once — they are separate
 * endpoints for exactly that reason.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { getArtifacts, getRun, listRuns, retryRun, startRun } from './pipeline.service.js';
import type { StartRunInput } from './pipeline.types.js';

export function startRunHandler(req: Request, res: Response): void {
  const body = req.body as StartRunInput;
  const run = startRun({ prompt: body.prompt, projectName: body.projectName });
  // 202: the run exists, the work is still happening.
  sendSuccess(res, run, { status: 202 });
}

function runId(req: Request): string {
  return typeof req.params.id === 'string' ? req.params.id : '';
}

export function getRunHandler(req: Request, res: Response): void {
  sendSuccess(res, getRun(runId(req)));
}

export function listRunsHandler(_req: Request, res: Response): void {
  sendSuccess(res, listRuns());
}

export function artifactsHandler(req: Request, res: Response): void {
  sendSuccess(res, getArtifacts(runId(req)));
}

export function retryRunHandler(req: Request, res: Response): void {
  sendSuccess(res, retryRun(runId(req)), { status: 202 });
}
