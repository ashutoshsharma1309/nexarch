/**
 * Request translation for enhancements. Every refusal says what to change,
 * because "invalid input" leaves a person with nothing to try next.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { isSafeResearchUrl } from '../web-research/index.js';
import {
  applyEnhancement,
  cancelEnhancement,
  currentEnhancementJob,
  getEnhancementJob,
  planEnhancement,
  revertEnhancement,
} from './enhancement.service.js';

const MAX_REFERENCE_URLS = 5;
const MAX_REFERENCE_URL_LENGTH = 2_048;
const MIN_INSTRUCTION = 8;
const MAX_INSTRUCTION = 2_000;

function scope(req: Request): { projectId: string; ownerId: string } {
  const user = req.user;
  if (!user) throw AppError.internal('enhancement handler called on an unguarded route');
  return { projectId: req.params.projectId as string, ownerId: user.id };
}

/** Refused here, so an unsafe address never reaches the research engine. */
function referenceUrlsOf(body: Record<string, unknown>): string[] {
  const raw = body.referenceUrls;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_REFERENCE_URLS) {
    throw AppError.badRequest(`Give at most ${String(MAX_REFERENCE_URLS)} reference sites.`);
  }
  return raw.map((entry: unknown) => {
    const url = typeof entry === 'string' ? entry.trim() : '';
    if (url.length === 0 || url.length > MAX_REFERENCE_URL_LENGTH || !isSafeResearchUrl(url)) {
      throw AppError.badRequest('Each reference site must be a public http(s) address.');
    }
    return url;
  });
}

function instructionOf(body: Record<string, unknown>): string {
  const raw = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (raw.length < MIN_INSTRUCTION) {
    throw AppError.badRequest(
      `Say what to change in at least ${String(MIN_INSTRUCTION)} characters, for example "add login and a protected dashboard".`,
    );
  }
  if (raw.length > MAX_INSTRUCTION) {
    throw AppError.badRequest(
      `That request is ${String(raw.length)} characters; the limit is ${String(MAX_INSTRUCTION)}.`,
    );
  }
  return raw;
}

export async function planHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.research !== undefined && typeof body.research !== 'boolean') {
    throw AppError.badRequest('`research` must be true or false when it is sent.');
  }
  const referenceUrls = referenceUrlsOf(body);
  sendSuccess(
    res,
    await planEnhancement({
      ...scope(req),
      instruction: instructionOf(body),
      ...(typeof body.research === 'boolean' ? { research: body.research } : {}),
      ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
    }),
  );
}

/** 202: the work has been accepted and is not finished. */
export async function applyHandler(req: Request, res: Response): Promise<void> {
  const job = await applyEnhancement({ ...scope(req), planId: req.params.planId as string });
  sendSuccess(res, job, { status: 202 });
}

export async function currentJobHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await currentEnhancementJob(scope(req)));
}

export async function jobHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getEnhancementJob({ ...scope(req), jobId: req.params.jobId as string }));
}

export async function cancelHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await cancelEnhancement({ ...scope(req), jobId: req.params.jobId as string }));
}

export async function revertHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await revertEnhancement({ ...scope(req), jobId: req.params.jobId as string }));
}
