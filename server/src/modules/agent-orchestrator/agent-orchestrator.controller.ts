/**
 * HTTP translation for the orchestrator. Ownership is resolved by the
 * service before any run state is touched.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { getAgentDefinition } from '../../shared/contracts/index.js';
import {
  cancelRun,
  getEngineeringReview,
  getProjectIntelligence,
  getRepairDetail,
  getRepairs,
  getValidation,
  startRepairSession,
  getProjectFinding,
  listProjectFindings,
  updateFindingStatus,
  getRunArtifact,
  getRunProjectFiles,
  listRunArtifacts,
  getEvents,
  getRun,
  listAgentRuns,
  listAgents,
  resumeRun,
  startRun,
} from './agent-orchestrator.service.js';
import type { AgentId, AgentPriority } from '../../shared/contracts/index.js';

const PRIORITIES: AgentPriority[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

const MAX_PROMPT_LENGTH = 4_000;

function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

export async function startHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 20) {
    throw AppError.badRequest('prompt must be at least 20 characters');
  }
  // Upper bound (Step 6): an unbounded prompt is unbounded AI tokens and
  // server memory. The pipeline capped this; the agent mesh entrypoint did
  // not, and it is the more expensive path.
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw AppError.badRequest(`prompt must be at most ${String(MAX_PROMPT_LENGTH)} characters`);
  }

  const rawAgents = Array.isArray(body.agentIds) ? body.agentIds : undefined;
  const agentIds = rawAgents
    ?.filter((value): value is string => typeof value === 'string')
    .map((value) => {
      if (!getAgentDefinition(value)) throw AppError.badRequest(`Unknown agent "${value}"`);
      return value as AgentId;
    });

  const rawPriority = typeof body.priority === 'string' ? body.priority.toUpperCase() : undefined;
  if (rawPriority && !PRIORITIES.includes(rawPriority as AgentPriority)) {
    throw AppError.badRequest(`priority must be one of: ${PRIORITIES.join(', ')}`);
  }

  const view = await startRun(ownerOf(req), {
    projectId: req.params.projectId as string,
    prompt,
    ...(agentIds?.length ? { agentIds } : {}),
    ...(rawPriority ? { priority: rawPriority as AgentPriority } : {}),
  });

  // 202: the run exists, the work is still happening.
  sendSuccess(res, view, { status: 202 });
}

export function getHandler(req: Request, res: Response): void {
  sendSuccess(res, getRun(ownerOf(req), req.params.runId as string));
}

export async function listHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listAgentRuns(ownerOf(req), req.params.projectId as string));
}

export function tasksHandler(req: Request, res: Response): void {
  sendSuccess(res, getRun(ownerOf(req), req.params.runId as string).run.tasks);
}

export function eventsHandler(req: Request, res: Response): void {
  const raw = req.query.after;
  const after = typeof raw === 'string' ? Number.parseInt(raw, 10) : 0;
  sendSuccess(
    res,
    getEvents(ownerOf(req), req.params.runId as string, Number.isFinite(after) ? after : 0),
  );
}

export function cancelHandler(req: Request, res: Response): void {
  sendSuccess(res, cancelRun(ownerOf(req), req.params.runId as string), { status: 202 });
}

export async function resumeHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await resumeRun(ownerOf(req), req.params.runId as string), { status: 202 });
}

export function artifactsHandler(req: Request, res: Response): void {
  sendSuccess(res, listRunArtifacts(ownerOf(req), req.params.runId as string));
}

export function artifactByTypeHandler(req: Request, res: Response): void {
  sendSuccess(
    res,
    getRunArtifact(ownerOf(req), req.params.runId as string, req.params.type as string),
  );
}

export function projectFilesHandler(req: Request, res: Response): void {
  sendSuccess(res, getRunProjectFiles(ownerOf(req), req.params.runId as string));
}

export async function findingsHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listProjectFindings(ownerOf(req), req.params.projectId as string));
}

export async function findingHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await getProjectFinding(
      ownerOf(req),
      req.params.projectId as string,
      req.params.findingId as string,
    ),
  );
}

export async function updateFindingHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { status?: unknown };
  sendSuccess(
    res,
    await updateFindingStatus(
      ownerOf(req),
      req.params.projectId as string,
      req.params.findingId as string,
      typeof body.status === 'string' ? body.status : '',
    ),
  );
}

export async function engineeringReviewHandler(req: Request, res: Response): Promise<void> {
  const raw = req.query.version;
  const version = typeof raw === 'string' ? Number.parseInt(raw, 10) : undefined;
  sendSuccess(
    res,
    await getEngineeringReview(
      ownerOf(req),
      req.params.projectId as string,
      Number.isFinite(version) ? version : undefined,
    ),
  );
}

export async function validationHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getValidation(ownerOf(req), req.params.projectId as string));
}

export async function startRepairsHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const overrides: Record<string, number> = {};
  for (const key of [
    'maxAttemptsPerFinding',
    'maxRepairsPerRun',
    'maxDurationMs',
    'maxTokens',
  ] as const) {
    const value = body[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) overrides[key] = value;
  }
  sendSuccess(
    res,
    await startRepairSession(ownerOf(req), req.params.projectId as string, overrides),
    { status: 202 },
  );
}

export async function repairsHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getRepairs(ownerOf(req), req.params.projectId as string));
}

export async function repairDetailHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await getRepairDetail(
      ownerOf(req),
      req.params.projectId as string,
      req.params.repairId as string,
    ),
  );
}

export async function intelligenceSummaryHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getProjectIntelligence(ownerOf(req), req.params.projectId as string));
}

export function agentsHandler(_req: Request, res: Response): void {
  sendSuccess(res, listAgents());
}
