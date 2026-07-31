/**
 * The Git Data API flow — the real mechanics behind "push generated
 * project to GitHub". Blobs → tree → commit → ref update, exactly the
 * steps `push-planner.ts` promises. Uses the low-level Git Data API
 * rather than the Contents API because a generated project is hundreds of
 * files: one commit with one tree beats hundreds of per-file commits both
 * for history readability and for rate-limit budget.
 */
import { AppError } from '../../../shared/utils/app-error.js';
import { githubRequest } from './github-client.js';
import { getRepository } from './repo-service.js';
import { resolvePushFiles } from './push-planner.js';
import type {
  CommitSummary,
  CreateBranchRequest,
  GithubBranch,
  PushRequest,
  PushResult,
} from '../github.types.js';

const BLOB_CONCURRENCY = 10;

interface ApiRef {
  object: { sha: string };
}

interface ApiCommit {
  sha: string;
  html_url: string;
  tree?: { sha: string };
}

interface ApiListedCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  try {
    const ref = await githubRequest<ApiRef>(
      token,
      'GET',
      `/repos/${owner}/${repo}/git/ref/${encodeURIComponent(`heads/${branch}`)}`,
    );
    return ref.object.sha;
  } catch {
    return null; // branch doesn't exist yet — callers decide whether to create it
  }
}

export async function createBranch(
  token: string,
  request: CreateBranchRequest,
): Promise<GithubBranch> {
  const { owner, repo, branch } = request;
  const fromBranch = request.fromBranch ?? (await getRepository(token, owner, repo)).defaultBranch;

  const baseSha = await getBranchHead(token, owner, repo, fromBranch);
  if (baseSha === null) {
    throw AppError.notFound(`Base branch "${fromBranch}" does not exist in ${owner}/${repo}`);
  }

  const ref = await githubRequest<ApiRef>(token, 'POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });
  return { name: branch, sha: ref.object.sha };
}

export async function listCommits(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<CommitSummary[]> {
  const commits = await githubRequest<ApiListedCommit[]>(
    token,
    'GET',
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=30`,
  );
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? '',
    htmlUrl: c.html_url,
  }));
}

/** Upload blobs in bounded batches — parallel enough to be fast, polite to the rate limit. */
async function createBlobs(
  token: string,
  owner: string,
  repo: string,
  files: { path: string; content: string }[],
): Promise<{ path: string; sha: string }[]> {
  const results: { path: string; sha: string }[] = [];
  for (let i = 0; i < files.length; i += BLOB_CONCURRENCY) {
    const batch = files.slice(i, i + BLOB_CONCURRENCY);
    const shas = await Promise.all(
      batch.map((file) =>
        githubRequest<{ sha: string }>(token, 'POST', `/repos/${owner}/${repo}/git/blobs`, {
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          encoding: 'base64',
        }),
      ),
    );
    results.push(...batch.map((file, index) => ({ path: file.path, sha: shas[index]?.sha ?? '' })));
  }
  return results;
}

export async function pushFiles(token: string, request: PushRequest): Promise<PushResult> {
  const { owner, repo, branch, message } = request;
  const files = resolvePushFiles(request);

  // 1. Resolve the branch head, creating the branch from the default when missing.
  const headSha =
    (await getBranchHead(token, owner, repo, branch)) ??
    (await createBranch(token, { owner, repo, branch })).sha;
  const headCommit = await githubRequest<ApiCommit>(
    token,
    'GET',
    `/repos/${owner}/${repo}/git/commits/${headSha}`,
  );

  // 2-3. Blobs, then one tree on top of the current head.
  const blobs = await createBlobs(token, owner, repo, files);
  const tree = await githubRequest<{ sha: string }>(
    token,
    'POST',
    `/repos/${owner}/${repo}/git/trees`,
    {
      base_tree: headCommit.tree?.sha,
      tree: blobs.map((blob) => ({ path: blob.path, mode: '100644', type: 'blob', sha: blob.sha })),
    },
  );

  // 4-5. Commit, then fast-forward the ref.
  const commit = await githubRequest<ApiCommit>(
    token,
    'POST',
    `/repos/${owner}/${repo}/git/commits`,
    { message, tree: tree.sha, parents: [headSha] },
  );
  await githubRequest(
    token,
    'PATCH',
    `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(`heads/${branch}`)}`,
    { sha: commit.sha },
  );

  return { commitSha: commit.sha, commitUrl: commit.html_url, branch, filesPushed: files.length };
}
