import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  generateDeployment,
  getHealthPreview,
  getStatus,
  runExport,
} from './deployment.service.js';
import { readExportRequest, readGenerateRequest } from './deployment.validator.js';

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
