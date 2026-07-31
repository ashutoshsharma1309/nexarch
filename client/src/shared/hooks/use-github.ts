/**
 * GitHub hooks. Everything network-y is `enabled` on the integration
 * being configured — the status endpoint is the cheap gate the rest of
 * the page hangs off, so an unconfigured deployment renders the full
 * connect experience without a single failed request.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createGithubRepo,
  getGithubStatus,
  getGithubUser,
  listGithubCommits,
  listGithubRepos,
  planGithubPush,
  pushToGithub,
} from '@/shared/services/github.service';
import type { GithubPushRequest } from '@/shared/types/api';

export function useGithubStatus() {
  return useQuery({ queryKey: ['github', 'status'], queryFn: getGithubStatus });
}

export function useGithubUser(configured: boolean) {
  return useQuery({
    queryKey: ['github', 'user'],
    queryFn: getGithubUser,
    enabled: configured,
  });
}

export function useGithubRepos(configured: boolean) {
  return useQuery({
    queryKey: ['github', 'repos'],
    queryFn: listGithubRepos,
    enabled: configured,
  });
}

export function useGithubCommits(owner: string | null, repo: string | null, branch: string) {
  return useQuery({
    queryKey: ['github', 'commits', owner, repo, branch],
    queryFn: () => {
      if (!owner || !repo) throw new Error('No repository selected');
      return listGithubCommits(owner, repo, branch);
    },
    enabled: Boolean(owner && repo),
  });
}

export function useCreateGithubRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGithubRepo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['github', 'repos'] });
    },
  });
}

export function usePlanGithubPush() {
  return useMutation({ mutationFn: (request: GithubPushRequest) => planGithubPush(request) });
}

export function usePushToGithub() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: GithubPushRequest) => pushToGithub(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['github', 'commits'] });
    },
  });
}
