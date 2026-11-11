import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import {
  createSession,
  getLogs,
  getSession,
  listSessions,
  planSession,
  restartSession,
  stopSession,
} from './runner.service.js';
import { resolveOwnedFiles } from './lib/owned-project-files.js';
import { readCreateSessionRequest, readRunSelection } from './runner.validator.js';

/** The authenticated owner of the request — every runner route is guarded. */
function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

export function planHandler(req: Request, res: Response): void {
  const request = readCreateSessionRequest(req.body as Record<string, unknown>);
  sendSuccess(res, planSession(request));
}

export async function createSessionHandler(req: Request, res: Response): Promise<void> {
  const ownerId = ownerOf(req);
  // The request names a generation; the bytes that run come from storage.
  const owned = await resolveOwnedFiles(
    readRunSelection(req.body as Record<string, unknown>),
    ownerId,
  );
  // 202: the session record is the answer; poll it to watch phases advance.
  sendSuccess(res, createSession(owned, ownerId), { status: 202 });
}

export function listSessionsHandler(req: Request, res: Response): void {
  sendSuccess(res, listSessions(ownerOf(req)));
}

export function getSessionHandler(req: Request, res: Response): void {
  sendSuccess(res, getSession(req.params.id as string, ownerOf(req)));
}

export function logsHandler(req: Request, res: Response): void {
  const after = typeof req.query.after === 'string' ? Number.parseInt(req.query.after, 10) : 0;
  sendSuccess(
    res,
    getLogs(req.params.id as string, Number.isFinite(after) ? after : 0, ownerOf(req)),
  );
}

export function stopSessionHandler(req: Request, res: Response): void {
  sendSuccess(res, stopSession(req.params.id as string, ownerOf(req)));
}

export function restartSessionHandler(req: Request, res: Response): void {
  sendSuccess(res, restartSession(req.params.id as string, ownerOf(req)), { status: 202 });
}
