import type {
  ApiSuccess,
  GithubCommitSummary,
  GithubPushPlan,
  GithubPushRequest,
  GithubPushResult,
  GithubRepoSummary,
  GithubStatus,
  GithubUser,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export async function getGithubStatus(): Promise<GithubStatus> {
  const response = await apiClient.get<ApiSuccess<GithubStatus>>('/github/status');
  return unwrap(response.data);
}

export async function getGithubUser(): Promise<GithubUser> {
  const response = await apiClient.get<ApiSuccess<GithubUser>>('/github/user');
  return unwrap(response.data);
}

export async function listGithubRepos(): Promise<GithubRepoSummary[]> {
  const response = await apiClient.get<ApiSuccess<GithubRepoSummary[]>>('/github/repositories');
  return unwrap(response.data);
}

export async function createGithubRepo(request: {
  name: string;
  description?: string;
  private: boolean;
}): Promise<GithubRepoSummary> {
  const response = await apiClient.post<ApiSuccess<GithubRepoSummary>>(
    '/github/repositories',
    request,
  );
  return unwrap(response.data);
}

export async function listGithubCommits(
  owner: string,
  repo: string,
  branch: string,
): Promise<GithubCommitSummary[]> {
  const response = await apiClient.get<ApiSuccess<GithubCommitSummary[]>>(
    `/github/repositories/${owner}/${repo}/commits`,
    { params: { branch } },
  );
  return unwrap(response.data);
}

export async function planGithubPush(request: GithubPushRequest): Promise<GithubPushPlan> {
  const response = await apiClient.post<ApiSuccess<GithubPushPlan>>('/github/push/plan', request);
  return unwrap(response.data);
}

export async function pushToGithub(request: GithubPushRequest): Promise<GithubPushResult> {
  // Pushing hundreds of blobs takes longer than the default client timeout.
  const response = await apiClient.post<ApiSuccess<GithubPushResult>>('/github/push', request, {
    timeout: 120_000,
  });
  return unwrap(response.data);
}
