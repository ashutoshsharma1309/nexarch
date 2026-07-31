import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  addBranch,
  createRepo,
  getCommits,
  getPushPlan,
  getRepo,
  getRepos,
  getStatus,
  getUser,
  push,
} from './github.service.js';
import {
  readCreateBranchRequest,
  readCreateRepoRequest,
  readPushRequest,
} from './github.validator.js';

export function statusHandler(_req: Request, res: Response): void {
  sendSuccess(res, getStatus());
}

export async function userHandler(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getUser());
}

export async function listReposHandler(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getRepos());
}

export async function createRepoHandler(req: Request, res: Response): Promise<void> {
  const request = readCreateRepoRequest(req.body as Record<string, unknown>);
  sendSuccess(res, await createRepo(request), { status: 201 });
}

export async function getRepoHandler(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getRepo(req.params.owner as string, req.params.repo as string));
}

export async function commitsHandler(req: Request, res: Response): Promise<void> {
  const owner = req.params.owner as string;
  const repo = req.params.repo as string;
  const branch = typeof req.query.branch === 'string' ? req.query.branch : 'main';
  sendSuccess(res, await getCommits(owner, repo, branch));
}

export async function createBranchHandler(req: Request, res: Response): Promise<void> {
  const request = readCreateBranchRequest(req.body as Record<string, unknown>);
  sendSuccess(res, await addBranch(request), { status: 201 });
}

export function pushPlanHandler(req: Request, res: Response): void {
  const request = readPushRequest(req.body as Record<string, unknown>);
  sendSuccess(res, getPushPlan(request));
}

export async function pushHandler(req: Request, res: Response): Promise<void> {
  const request = readPushRequest(req.body as Record<string, unknown>);
  sendSuccess(res, await push(request), { status: 201 });
}
