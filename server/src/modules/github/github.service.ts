/**
 * GitHub service — the seam between HTTP handlers and the `lib/` layers.
 * Execution paths resolve credentials first and fail fast when the
 * integration is disabled; `getStatus` and `getPushPlan` never touch the
 * network, so the console can render the full GitHub experience (status,
 * plan, progress states) with no token configured.
 */
import { requireCredentials, resolveCredentials } from './lib/credentials.js';
import { createBranch, listCommits, pushFiles } from './lib/commit-service.js';
import { planPush } from './lib/push-planner.js';
import {
  createRepository,
  fetchAuthenticatedUser,
  getRepository,
  listRepositories,
} from './lib/repo-service.js';
import type {
  CommitSummary,
  CreateBranchRequest,
  CreateRepoRequest,
  GithubBranch,
  GithubRepoSummary,
  GithubStatus,
  GithubUser,
  PushPlan,
  PushRequest,
  PushResult,
} from './github.types.js';

export function getStatus(): GithubStatus {
  const credentials = resolveCredentials();
  return {
    configured: credentials !== null,
    tokenSource: credentials?.source ?? 'none',
    capabilities: [
      'repository-list',
      'repository-create',
      'branch-create',
      'commit-history',
      'push-plan',
      'push',
      'readme-generation',
    ],
    enableHint: credentials
      ? null
      : 'Set GITHUB_TOKEN (fine-grained personal access token with repo scope) and restart the server.',
  };
}

export async function getUser(): Promise<GithubUser> {
  return fetchAuthenticatedUser(requireCredentials().token);
}

export async function getRepos(): Promise<GithubRepoSummary[]> {
  return listRepositories(requireCredentials().token);
}

export async function createRepo(request: CreateRepoRequest): Promise<GithubRepoSummary> {
  return createRepository(requireCredentials().token, request);
}

export async function getRepo(owner: string, repo: string): Promise<GithubRepoSummary> {
  return getRepository(requireCredentials().token, owner, repo);
}

export async function getCommits(
  owner: string,
  repo: string,
  branch: string,
): Promise<CommitSummary[]> {
  return listCommits(requireCredentials().token, owner, repo, branch);
}

export async function addBranch(request: CreateBranchRequest): Promise<GithubBranch> {
  return createBranch(requireCredentials().token, request);
}

/** Pure dry-run — deliberately works with no credentials configured. */
export function getPushPlan(request: PushRequest): PushPlan {
  return planPush(request);
}

export async function push(request: PushRequest): Promise<PushResult> {
  return pushFiles(requireCredentials().token, request);
}
