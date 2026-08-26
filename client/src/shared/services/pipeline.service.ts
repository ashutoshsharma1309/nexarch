/**
 * The end-to-end generation API.
 *
 * The run and its artifacts are two calls on purpose: the run is a few
 * hundred bytes and gets polled every second while stages advance; the
 * artifact bundle is megabytes and is fetched exactly once, when the run
 * reports `completed`.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, PipelineArtifacts, PipelineRun } from '@/shared/types/api';

export interface StartRunPayload {
  prompt: string;
  projectName?: string;
}

export async function startRun(payload: StartRunPayload): Promise<PipelineRun> {
  const { data } = await apiClient.post<ApiSuccess<PipelineRun>>('/pipeline/runs', payload);
  return unwrap(data);
}

export async function fetchRun(id: string): Promise<PipelineRun> {
  const { data } = await apiClient.get<ApiSuccess<PipelineRun>>(`/pipeline/runs/${id}`);
  return unwrap(data);
}

export async function fetchRuns(): Promise<PipelineRun[]> {
  const { data } = await apiClient.get<ApiSuccess<PipelineRun[]>>('/pipeline/runs');
  return unwrap(data);
}

export async function fetchArtifacts(id: string): Promise<PipelineArtifacts> {
  const { data } = await apiClient.get<ApiSuccess<PipelineArtifacts>>(
    `/pipeline/runs/${id}/artifacts`,
    // The bundle is large; generation itself is already done by this point,
    // so the only thing this timeout guards is the transfer.
    { timeout: 60_000 },
  );
  return unwrap(data);
}

export async function retryRun(id: string): Promise<PipelineRun> {
  const { data } = await apiClient.post<ApiSuccess<PipelineRun>>(`/pipeline/runs/${id}/retry`);
  return unwrap(data);
}
