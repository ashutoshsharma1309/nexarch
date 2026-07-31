/**
 * Contracts for the GitHub Integration Engine (Phase 13).
 *
 * Everything here is production-shaped from day one: the service layer
 * speaks the real GitHub REST + Git Data APIs. What gates execution is a
 * single credential check — until a token is configured the module reports
 * itself disabled and every network-touching endpoint fails fast with a
 * clear FORBIDDEN, while planning endpoints (push plan, README preview)
 * work fully so the whole flow is exercisable without secrets.
 */

/* ── Status ───────────────────────────────────────────────────────────── */

export interface GithubStatus {
  /** True when a token is present — the only difference between disabled and live. */
  configured: boolean;
  tokenSource: 'environment' | 'none';
  capabilities: string[];
  /** How to enable the integration when it is disabled. */
  enableHint: string | null;
}

export interface GithubUser {
  login: string;
  name: string | null;
  htmlUrl: string;
  publicRepos: number;
}

/* ── Repositories ─────────────────────────────────────────────────────── */

export interface GithubRepoSummary {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
}

export interface CreateRepoRequest {
  name: string;
  description?: string | undefined;
  private: boolean;
}

/* ── Branches & commits ───────────────────────────────────────────────── */

export interface CreateBranchRequest {
  owner: string;
  repo: string;
  branch: string;
  /** Defaults to the repository's default branch. */
  fromBranch?: string | undefined;
}

export interface GithubBranch {
  name: string;
  sha: string;
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
}

/* ── Push flow ────────────────────────────────────────────────────────── */

export interface PushFile {
  path: string;
  content: string;
}

/** Facts the README generator writes from — supplied by the client from pipeline artifacts. */
export interface PushProjectMeta {
  projectName: string;
  description?: string | undefined;
  stack?: string[] | undefined;
}

export interface PushRequest {
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: PushFile[];
  /** Generate and include a README.md unless the files already carry one. */
  generateReadme: boolean;
  projectMeta?: PushProjectMeta | undefined;
}

export interface PushStep {
  name: string;
  description: string;
}

/** The dry-run: everything about the push except doing it. */
export interface PushPlan {
  owner: string;
  repo: string;
  branch: string;
  fileCount: number;
  totalBytes: number;
  readmeIncluded: boolean;
  steps: PushStep[];
  warnings: string[];
}

export interface PushResult {
  commitSha: string;
  commitUrl: string;
  branch: string;
  filesPushed: number;
}
