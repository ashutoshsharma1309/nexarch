import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  executeDeploy,
  generateDeployment,
  getDeployExecution,
  getHealthPreview,
  getProviders,
  getStatus,
  listDeployExecutions,
  planDeployExecution,
  runExport,
} from './deployment.service.js';
import {
  readExecuteDeployRequest,
  readExportRequest,
  readGenerateRequest,
} from './deployment.validator.js';

export function generateHandler(req: Request, res: Response): void {
  const request = readGenerateRequest(req.body as Record<string, unknown>);
  sendSuccess(res, generateDeployment(request));
}

export function exportHandler(req: Request, res: Response): void {
  const request = readExportRequest(req.body as Record<string, unknown>);
  sendSuccess(res, runExport(request));
}

export function statusHandler(_req: Request, res: Response): void {
  sendSuccess(res, getStatus());
}

export function healthHandler(_req: Request, res: Response): void {
  sendSuccess(res, getHealthPreview());
}

/* ── One-click deploy execution (Phase 13) ────────────────────────────── */

export function providersHandler(_req: Request, res: Response): void {
  sendSuccess(res, getProviders());
}

export function executePlanHandler(req: Request, res: Response): void {
  const request = readExecuteDeployRequest(req.body as Record<string, unknown>);
  sendSuccess(res, planDeployExecution(request));
}

export function executeHandler(req: Request, res: Response): void {
  const request = readExecuteDeployRequest(req.body as Record<string, unknown>);
  // 202: the execution record is the answer; its phase transitions are the progress.
  sendSuccess(res, executeDeploy(request), { status: 202 });
}

export function executionsHandler(_req: Request, res: Response): void {
  sendSuccess(res, listDeployExecutions());
}

export function executionHandler(req: Request, res: Response): void {
  sendSuccess(res, getDeployExecution(req.params.id as string));
}
