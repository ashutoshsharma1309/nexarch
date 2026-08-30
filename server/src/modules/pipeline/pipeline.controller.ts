/**
 * HTTP translation for the pipeline. The run object is small and polled;
 * the artifact bundle is large and fetched once — they are separate
 * endpoints for exactly that reason.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { findOrCreateBySlug } from '../workspace/lib/project-store.js';
import { deriveProjectName } from './lib/ai-stages.js';
import {
  getArtifact,
  getArtifacts,
  getRun,
  listArtifacts,
  listRuns,
  retryRun,
  startRun,
} from './pipeline.service.js';
import type { StartRunInput } from './pipeline.types.js';

/**
 * The owner of the request. `requireAuth` runs before every handler that
 * calls this, so a missing user is a wiring mistake rather than an
 * unauthenticated caller — hence a thrown error, not a 401.
 */
function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

export async function startRunHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as StartRunInput;
  const run = startRun(
    {
      prompt: body.prompt,
      projectName: body.projectName,
      // Resolving the project is the controller's job: it is the only layer
      // that knows who is asking. Re-running a prompt for the same product
      // lands in the same project rather than littering the workspace.
      projectId: (await resolveProject(req, body)).id,
    },
    ownerOf(req),
  );
  // 202: the run exists, the work is still happening.
  sendSuccess(res, run, { status: 202 });
}

async function resolveProject(req: Request, body: StartRunInput): Promise<{ id: string }> {
  const name = body.projectName?.trim();
  return findOrCreateBySlug(
    ownerOf(req),
    name && name !== '' ? name : deriveProjectName(body.prompt),
  );
}

function runId(req: Request): string {
  return typeof req.params.id === 'string' ? req.params.id : '';
}

export function getRunHandler(req: Request, res: Response): void {
  sendSuccess(res, getRun(runId(req), ownerOf(req)));
}

export function listRunsHandler(req: Request, res: Response): void {
  sendSuccess(res, listRuns(ownerOf(req)));
}

export function artifactsHandler(req: Request, res: Response): void {
  sendSuccess(res, getArtifacts(runId(req), ownerOf(req)));
}

export function retryRunHandler(req: Request, res: Response): void {
  sendSuccess(res, retryRun(runId(req), null, ownerOf(req)), { status: 202 });
}

/** The artifact manifest: what exists and how big, without the content. */
export function artifactManifestHandler(req: Request, res: Response): void {
  sendSuccess(res, listArtifacts(runId(req), ownerOf(req)));
}

/** One artifact by type. */
export function artifactByTypeHandler(req: Request, res: Response): void {
  sendSuccess(res, getArtifact(runId(req), req.params.type as string, ownerOf(req)));
}
