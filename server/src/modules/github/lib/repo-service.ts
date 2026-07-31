/**
 * Repository-level operations: the authenticated user, listing/creating/
 * inspecting repositories. Each function takes the token explicitly —
 * credential resolution stays in `credentials.ts`, network mapping stays
 * in `github-client.ts`, so this layer is nothing but GitHub domain calls.
 */
import { githubRequest } from './github-client.js';
import type { CreateRepoRequest, GithubRepoSummary, GithubUser } from '../github.types.js';

interface ApiUser {
  login: string;
  name: string | null;
  html_url: string;
  public_repos: number;
}

interface ApiRepo {
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  description: string | null;
  updated_at: string;
  owner: { login: string };
}

function toRepoSummary(repo: ApiRepo): GithubRepoSummary {
  return {
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    htmlUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    description: repo.description,
    updatedAt: repo.updated_at,
  };
}

export async function fetchAuthenticatedUser(token: string): Promise<GithubUser> {
  const user = await githubRequest<ApiUser>(token, 'GET', '/user');
  return {
    login: user.login,
    name: user.name,
    htmlUrl: user.html_url,
    publicRepos: user.public_repos,
  };
}

export async function listRepositories(token: string): Promise<GithubRepoSummary[]> {
  const repos = await githubRequest<ApiRepo[]>(
    token,
    'GET',
    '/user/repos?per_page=100&sort=updated&affiliation=owner',
  );
  return repos.map(toRepoSummary);
}

export async function createRepository(
  token: string,
  request: CreateRepoRequest,
): Promise<GithubRepoSummary> {
  const repo = await githubRequest<ApiRepo>(token, 'POST', '/user/repos', {
    name: request.name,
    description: request.description ?? '',
    private: request.private,
    auto_init: true, // an initial commit gives every later push a parent to build on
  });
  return toRepoSummary(repo);
}

export async function getRepository(
  token: string,
  owner: string,
  repo: string,
): Promise<GithubRepoSummary> {
  return toRepoSummary(await githubRequest<ApiRepo>(token, 'GET', `/repos/${owner}/${repo}`));
}
