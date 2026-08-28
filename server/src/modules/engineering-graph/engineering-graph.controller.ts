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
  validate,
} from './engineering-graph.service.js';
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
  const path = await getPath(ownerOf(req), projectId(req), nodeId(req), to);
  sendSuccess(res, path);
}

export async function validateHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await validate(ownerOf(req), projectId(req)));
}
