/**
 * Request translation for project edits. Every refusal here names what was
 * wrong with the request, because "invalid input" leaves a user with nothing
 * to try next.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { acceptImage, ImageRejected } from './lib/image-input.js';
import {
  currentEditJob,
  getEditJob,
  getPlan,
  planEdit,
  startEditJob,
} from './project-editor.service.js';
import type { AcceptedImage } from './lib/image-input.js';

const MIN_INSTRUCTION = 8;
const MAX_INSTRUCTION = 2_000;

function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

function projectId(req: Request): string {
  return req.params.projectId as string;
}

function instructionOf(body: Record<string, unknown>): string {
  const raw = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (raw.length < MIN_INSTRUCTION) {
    throw AppError.badRequest(
      `Say what to change in at least ${String(MIN_INSTRUCTION)} characters — "make the hero warmer and put the menu first" is enough.`,
    );
  }
  if (raw.length > MAX_INSTRUCTION) {
    throw AppError.badRequest(
      `That instruction is ${String(raw.length)} characters; the limit is ${String(MAX_INSTRUCTION)}.`,
    );
  }
  return raw;
}

function imageOf(body: Record<string, unknown>): AcceptedImage | null {
  const raw = body.image;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    throw AppError.badRequest('`image` must be an object with `dataUrl` and `kind`.');
  }
  const candidate = raw as Record<string, unknown>;
  try {
    return acceptImage({
      dataUrl: typeof candidate.dataUrl === 'string' ? candidate.dataUrl : '',
      kind: typeof candidate.kind === 'string' ? candidate.kind : '',
      ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
    });
  } catch (error) {
    // A rejected image is the user's problem to fix, not a server fault.
    if (error instanceof ImageRejected) throw AppError.badRequest(error.message);
    throw error;
  }
}

export async function planHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  sendSuccess(
    res,
    await planEdit({
      projectId: projectId(req),
      ownerId: ownerOf(req),
      instruction: instructionOf(body),
      image: imageOf(body),
    }),
  );
}

export function planDetailHandler(req: Request, res: Response): void {
  sendSuccess(res, getPlan(req.params.planId as string, ownerOf(req)));
}

/**
 * Start the edit and answer immediately with the job to poll.
 *
 * 202, not 200: the work has been accepted and is not finished. The old
 * endpoint held the request open for five or six minutes, which made the
 * client's timeout a race it sometimes lost — reporting failure for an edit
 * the server then applied anyway.
 */
export async function applyHandler(req: Request, res: Response): Promise<void> {
  const job = await startEditJob(req.params.planId as string, ownerOf(req));
  sendSuccess(res, job, { status: 202 });
}

export async function jobHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getEditJob(req.params.jobId as string, ownerOf(req)));
}

/**
 * What this project's edit state is, without the client having to remember a
 * job id — which is exactly what it loses on a page reload.
 */
export async function currentJobHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await currentEditJob(projectId(req), ownerOf(req)));
}
