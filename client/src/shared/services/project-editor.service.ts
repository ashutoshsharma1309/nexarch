/**
 * Editing a project that already exists, rather than generating a new one.
 *
 * Apply used to carry its own five-minute timeout, because the request was
 * held open for the whole install-build-typecheck-lint-start cycle. That is
 * no longer what happens: apply now creates a job row and returns, so the
 * call is two database round-trips and the long work is followed by polling
 * `fetchEditJob`. The override was therefore removed rather than left as
 * harmless dead configuration — with the work moved off the request, a five
 * minute ceiling on an accept that should answer in milliseconds would hide
 * a hung server behind a spinner, where the shared 30s default surfaces it.
 *
 * Planning still reads an image with a vision model and writes a proposed
 * design, and still answers within the default.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, EditJob, EditPlan, ImageKind } from '@/shared/types/api';

export interface PlanEditImage {
  /** A base64 `data:image/png|jpeg|webp;base64,…` URL built in the browser. */
  dataUrl: string;
  kind: ImageKind;
  name?: string;
}

export interface PlanEditPayload {
  instruction: string;
  image?: PlanEditImage;
}

export async function planEdit(projectId: string, payload: PlanEditPayload): Promise<EditPlan> {
  const { data } = await apiClient.post<ApiSuccess<EditPlan>>(
    `/projects/${projectId}/edits/plan`,
    payload,
    // Two model calls deep — the image reading and the design — so a few
    // seconds normally, and more when a provider is slow.
    { timeout: 90_000 },
  );
  return unwrap(data);
}

export async function fetchEditPlan(projectId: string, planId: string): Promise<EditPlan> {
  const { data } = await apiClient.get<ApiSuccess<EditPlan>>(
    `/projects/${projectId}/edits/${planId}`,
  );
  return unwrap(data);
}

/**
 * Start the edit. Returns as soon as the server has accepted the work.
 *
 * The apply itself takes minutes; it used to be held open in this request,
 * which made the timeout a race the user could lose — a failure here while
 * the server applied the edit anyway. Now this call is short and the job is
 * polled.
 */
export async function applyEdit(projectId: string, planId: string): Promise<EditJob> {
  const { data } = await apiClient.post<ApiSuccess<EditJob>>(
    `/projects/${projectId}/edits/${planId}/apply`,
  );
  return unwrap(data);
}

export async function fetchEditJob(projectId: string, jobId: string): Promise<EditJob> {
  const { data } = await apiClient.get<ApiSuccess<EditJob>>(
    `/projects/${projectId}/edits/jobs/${jobId}`,
  );
  return unwrap(data);
}

/**
 * The edit this project is in the middle of, or the last one it finished.
 *
 * Read once on load so a page reload — or a second tab — picks up the edit
 * already running instead of looking idle and inviting a duplicate.
 */
export async function fetchCurrentEditJob(projectId: string): Promise<EditJob | null> {
  const { data } = await apiClient.get<ApiSuccess<EditJob | null>>(
    `/projects/${projectId}/edits/jobs/current`,
  );
  return unwrap(data);
}
