/**
 * Editing a project that already exists, rather than generating a new one.
 *
 * Three calls with three very different costs, and each one says so: the plan
 * reads an image with a vision model and writes a proposed design, the plan
 * detail is a cheap read of something already computed, and apply installs,
 * builds, type-checks, lints and starts the edited project before it answers.
 * The timeouts are per call for that reason — the client's 30s default is
 * right for the rest of the API and would abort an apply that is going fine.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, EditPlan, EditResult, ImageKind } from '@/shared/types/api';

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

export async function applyEdit(projectId: string, planId: string): Promise<EditResult> {
  const { data } = await apiClient.post<ApiSuccess<EditResult>>(
    `/projects/${projectId}/edits/${planId}/apply`,
    undefined,
    // One to two minutes of real work — npm install, a production build, tsc,
    // lint, and starting the app. The window is wide enough for the slow end
    // of that range and no wider: past five minutes something is wrong, and
    // waiting forever is not a better answer than saying so.
    { timeout: 300_000 },
  );
  return unwrap(data);
}
