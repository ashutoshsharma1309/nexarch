import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  createSession,
  getLogs,
  getSession,
  listSessions,
  planSession,
  restartSession,
  stopSession,
} from './runner.service.js';
import { readCreateSessionRequest } from './runner.validator.js';

export function planHandler(req: Request, res: Response): void {
  const request = readCreateSessionRequest(req.body as Record<string, unknown>);
  sendSuccess(res, planSession(request));
}

export function createSessionHandler(req: Request, res: Response): void {
  const request = readCreateSessionRequest(req.body as Record<string, unknown>);
  // 202: the session record is the answer; poll it to watch phases advance.
  sendSuccess(res, createSession(request), { status: 202 });
}

export function listSessionsHandler(_req: Request, res: Response): void {
  sendSuccess(res, listSessions());
}

export function getSessionHandler(req: Request, res: Response): void {
  sendSuccess(res, getSession(req.params.id as string));
}

export function logsHandler(req: Request, res: Response): void {
  const after = typeof req.query.after === 'string' ? Number.parseInt(req.query.after, 10) : 0;
  sendSuccess(res, getLogs(req.params.id as string, Number.isFinite(after) ? after : 0));
}

export function stopSessionHandler(req: Request, res: Response): void {
  sendSuccess(res, stopSession(req.params.id as string));
}

export function restartSessionHandler(req: Request, res: Response): void {
  sendSuccess(res, restartSession(req.params.id as string), { status: 202 });
}
