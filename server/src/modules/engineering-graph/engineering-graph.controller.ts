/**
 * HTTP translation for the Engineering Graph. Handlers narrow the request
 * and hand the owner id to the service, which enforces project ownership
 * before any graph table is read.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { GRAPH_NODE_TYPES } from '../../shared/contracts/index.js';
import {
  getDependencies,
  getDependents,
  getGraph,
  getImpact,
  getNode,
  getPath,
  synchronize,
  validate,
} from './engineering-graph.service.js';
import { getArtifactsIfReady } from '../pipeline/pipeline.service.js';
import { listRunsForProject } from '../pipeline/lib/run-store.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import type { GraphNodeType } from '../../shared/contracts/index.js';

function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('ownerOf called on an unguarded route');
  return user.id;
}

function projectId(req: Request): string {
  return req.params.projectId as string;
}

function nodeId(req: Request): string {
  return req.params.nodeId as string;
}

/** Optional `?type=ENTITY` filter, rejected rather than ignored when unknown. */
function typeFilter(req: Request): GraphNodeType | undefined {
  const raw = req.query.type;
  if (typeof raw !== 'string' || raw === '') return undefined;
  const value = raw.toUpperCase();
  if (!(GRAPH_NODE_TYPES as string[]).includes(value)) {
    throw AppError.badRequest(`Unknown node type "${raw}"`);
  }
  return value as GraphNodeType;
}

function depth(req: Request, fallback: number): number {
  const raw = req.query.depth;
  if (typeof raw !== 'string') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 6) {
    throw AppError.badRequest('depth must be between 1 and 6');
  }
  return parsed;
}

export async function graphHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getGraph(ownerOf(req), projectId(req), typeFilter(req)));
}

export async function nodeHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getNode(ownerOf(req), projectId(req), nodeId(req)));
}

export async function dependenciesHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await getDependencies(ownerOf(req), projectId(req), nodeId(req), {
      maxDepth: depth(req, 1),
    }),
  );
}

export async function dependentsHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await getDependents(ownerOf(req), projectId(req), nodeId(req), { maxDepth: depth(req, 1) }),
  );
}

export async function impactHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getImpact(ownerOf(req), projectId(req), nodeId(req), depth(req, 3)));
}

export async function pathHandler(req: Request, res: Response): Promise<void> {
  const to = req.query.to;
  if (typeof to !== 'string' || to === '') {
    throw AppError.badRequest('A `to` node id is required');
  }
  // `any` walks edges from either end. It is opt-in because the two answers
  // mean different things: "what does this reach" versus "is this connected
  // to that at all".
  const raw = req.query.direction;
  if (raw !== undefined && raw !== 'outgoing' && raw !== 'any') {
    throw AppError.badRequest('`direction` must be `outgoing` or `any`');
  }
  const path = await getPath(ownerOf(req), projectId(req), nodeId(req), to, raw ?? 'outgoing');
  sendSuccess(res, path);
}

export async function validateHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await validate(ownerOf(req), projectId(req)));
}

/**
 * Recompute the graph from this project's most recent completed build.
 *
 * The pipeline already synchronizes the graph at the end of every run, so
 * this exists for the case the automatic path cannot cover: a graph read
 * after the API restarted, or one a user simply wants to confirm is current.
 *
 * It lives in the controller rather than the service on purpose. The pipeline
 * imports the graph service to synchronize at the end of a run; having the
 * graph service import the pipeline back would close that loop. The handler
 * is the one place that may know about both.
 */
export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const ownerId = ownerOf(req);
  const id = projectId(req);
  await getProjectOrThrow(ownerId, id);

  const runs = await listRunsForProject(id, 20);
  const latest = runs.find((run) => run.status === 'COMPLETED');
  if (!latest) {
    throw AppError.badRequest(
      'This project has no completed build yet, so there is nothing to map',
    );
  }

  const artifacts = getArtifactsIfReady(latest.id);
  if (!artifacts) {
    // Artifacts are held in the API process; a restart loses them. Say so,
    // rather than quietly serving the graph that is already stored.
    throw AppError.conflict(
      "The latest build's output is no longer held by the server, so the graph cannot be recomputed from it. Rebuild the project to refresh the graph.",
    );
  }

  await synchronize(id, latest.id, artifacts);
  sendSuccess(res, await getGraph(ownerId, id));
}
