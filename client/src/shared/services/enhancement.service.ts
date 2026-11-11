/**
 * Enhancing a project that already exists: plan, apply, watch, cancel, revert.
 *
 * Unlike a plain edit, which re-runs the generators over a new design, an
 * enhancement changes source files from a plan made against those files. The
 * types mirror the server's `enhancement.types.ts`; they live here rather than
 * in `api.ts` so this surface can move without touching the shared file.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, EditChangedFile, EditImpact, EditJobStatus } from '@/shared/types/api';
import type { ExecutionEvent } from '@/shared/types/execution';

export type PlannedFileAction = 'create' | 'modify' | 'delete';

export interface PlannedFile {
  path: string;
  action: PlannedFileAction;
  reason: string;
}

/** An environment variable the change adds. A placeholder, never a value. */
export interface EnhancementEnvChange {
  name: string;
  purpose: string;
  example: string;
}

export interface CoverageArea {
  /** The project already had this area and the change left it alone. */
  alreadyPresent?: boolean;
  area: string;
  label: string;
  satisfied: boolean;
  paths: string[];
}

export interface EnhancementResearchInfo {
  outcome: 'not-needed' | 'skipped' | 'ran';
  /** Why research did or did not run. Always a real reason. */
  reason: string;
  sourceCount: number;
  findingCount: number;
  limitations: string[];
}

export interface EnhancementPlan {
  planId: string;
  projectId: string;
  instruction: string;
  summary: string;
  steps: string[];
  filesLikelyTouched: string[];
  limitations: string[];
  createdAt: string;
  kind: string;
  basedOnRunId: string;
  files: PlannedFile[];
  impact: EditImpact;
  /** True when a person should read this before it runs. */
  substantial: boolean;
  risks: string[];
  envChanges: EnhancementEnvChange[];
  research: EnhancementResearchInfo;
  coverage: CoverageArea[];
  validationPlan: string[];
  status: 'planned' | 'applying' | 'applied' | 'rejected' | 'failed' | 'cancelled';
}

export interface FunctionalCheckStep {
  name: string;
  method: string;
  path: string;
  expected: string;
  actualStatus: number | null;
  passed: boolean;
  detail: string | null;
}

export interface FunctionalCheckResult {
  kind: 'auth' | 'crud';
  label: string;
  passed: boolean;
  steps: FunctionalCheckStep[];
  limitations: string[];
}

export interface StoredVerificationStep {
  id: string;
  status: string;
  command: string | null;
  exitCode: number | null;
  durationMs: number;
  summary: string;
  reason: string | null;
}

export interface EnhancementResult {
  planId: string;
  projectId: string;
  status: 'applied' | 'rejected' | 'failed' | 'cancelled';
  runId: string | null;
  /** The run it started from; what a revert restores. */
  baseRunId: string;
  kind: string;
  changedFiles: EditChangedFile[];
  unchangedFileCount: number;
  outcome: string;
  /** True when the project keeps the files it had before this started. */
  rolledBack: boolean;
  completedAt: string;
  verification: {
    ran: boolean;
    ok: boolean;
    steps: StoredVerificationStep[];
    failedRoutes: string[];
  };
  repair: {
    attempted: number;
    repaired: boolean;
    restoredUnplannedFiles: string[];
    /** What the first verification found, before any repair. */
    initialFailures?: { id: string; status: string; summary: string }[];
  };
  functionalChecks: FunctionalCheckResult[];
  coverage: CoverageArea[];
  /** Files the plan named that were never actually changed. */
  plannedButUnchanged: string[];
  limitations: string[];
  /** Null means the provider did not report it: show "unknown", never 0. */
  usage: {
    calls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
}

export interface EnhancementStageRecord {
  stage: string;
  startedAt: string;
  completedAt: string | null;
  detail: string | null;
}

export interface EnhancementJob {
  id: string;
  projectId: string;
  planId: string;
  kind: 'EDIT' | 'ENHANCEMENT';
  cancelRequested: boolean;
  status: EditJobStatus;
  stage: string;
  stages: EnhancementStageRecord[];
  instruction: string;
  result: EnhancementResult | null;
  error: string | null;
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanEnhancementPayload {
  instruction: string;
  /** Omitted lets the server decide; an explicit false always wins there. */
  research?: boolean;
  /** Sites the planner's web research opens and measures. */
  referenceUrls?: string[];
}

/** The most one page of events can hold; a full page means there may be more. */
export const EVENT_PAGE_LIMIT = 500;

/**
 * Write a plan. Nothing in the project changes.
 *
 * It reads the project, may search the web and calls a model, and any of
 * those can be slow or fail over, so the shared 30s default would report a
 * failure for work that was about to succeed.
 */
export async function planEnhancement(
  projectId: string,
  payload: PlanEnhancementPayload,
): Promise<EnhancementPlan> {
  const { data } = await apiClient.post<ApiSuccess<EnhancementPlan>>(
    `/projects/${projectId}/enhancements/plan`,
    payload,
    { timeout: 300_000 },
  );
  return unwrap(data);
}

/** Start the work. Returns as soon as the server has accepted it. */
export async function applyEnhancement(projectId: string, planId: string): Promise<EnhancementJob> {
  const { data } = await apiClient.post<ApiSuccess<EnhancementJob>>(
    `/projects/${projectId}/enhancements/${planId}/apply`,
  );
  return unwrap(data);
}

export async function fetchEnhancementJob(
  projectId: string,
  jobId: string,
): Promise<EnhancementJob> {
  const { data } = await apiClient.get<ApiSuccess<EnhancementJob>>(
    `/projects/${projectId}/enhancements/jobs/${jobId}`,
  );
  return unwrap(data);
}

/** The enhancement running now, or the last one this owner finished. */
export async function fetchCurrentEnhancementJob(
  projectId: string,
): Promise<EnhancementJob | null> {
  const { data } = await apiClient.get<ApiSuccess<EnhancementJob | null>>(
    `/projects/${projectId}/enhancements/jobs/current`,
  );
  return unwrap(data);
}

/** Ask the job to stop. The worker honours it between steps, not instantly. */
export async function cancelEnhancement(projectId: string, jobId: string): Promise<EnhancementJob> {
  const { data } = await apiClient.post<ApiSuccess<EnhancementJob>>(
    `/projects/${projectId}/enhancements/jobs/${jobId}/cancel`,
  );
  return unwrap(data);
}

/** Restore the files from before this enhancement, as a new version. */
export async function revertEnhancement(
  projectId: string,
  jobId: string,
): Promise<{ runId: string; restoredRunId: string }> {
  const { data } = await apiClient.post<ApiSuccess<{ runId: string; restoredRunId: string }>>(
    `/projects/${projectId}/enhancements/jobs/${jobId}/revert`,
    undefined,
    // It writes a new run holding every file of the older version.
    { timeout: 120_000 },
  );
  return unwrap(data);
}

/** One page of a job's recorded events, those after `after`. */
export async function fetchEnhancementEvents(
  projectId: string,
  jobId: string,
  after: number,
): Promise<ExecutionEvent[]> {
  const { data } = await apiClient.get<ApiSuccess<ExecutionEvent[]>>(
    `/projects/${projectId}/executions/${jobId}/events`,
    { params: { after } },
  );
  return unwrap(data);
}
