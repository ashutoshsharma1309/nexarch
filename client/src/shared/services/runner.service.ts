import type {
  ApiSuccess,
  CreateRunSessionRequest,
  RunLogChunk,
  RunPlan,
  RunSession,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export async function planRunSession(request: CreateRunSessionRequest): Promise<RunPlan> {
  const response = await apiClient.post<ApiSuccess<RunPlan>>('/runner/plan', request);
  return unwrap(response.data);
}

export async function createRunSession(request: CreateRunSessionRequest): Promise<RunSession> {
  // A generated project is hundreds of files — give the upload headroom.
  const response = await apiClient.post<ApiSuccess<RunSession>>('/runner/sessions', request, {
    timeout: 60_000,
  });
  return unwrap(response.data);
}

export async function listRunSessions(): Promise<RunSession[]> {
  const response = await apiClient.get<ApiSuccess<RunSession[]>>('/runner/sessions');
  return unwrap(response.data);
}

export async function getRunSession(id: string): Promise<RunSession> {
  const response = await apiClient.get<ApiSuccess<RunSession>>(`/runner/sessions/${id}`);
  return unwrap(response.data);
}

export async function getRunLogs(id: string, after: number): Promise<RunLogChunk> {
  const response = await apiClient.get<ApiSuccess<RunLogChunk>>(`/runner/sessions/${id}/logs`, {
    params: { after },
  });
  return unwrap(response.data);
}

export async function stopRunSession(id: string): Promise<RunSession> {
  const response = await apiClient.post<ApiSuccess<RunSession>>(`/runner/sessions/${id}/stop`);
  return unwrap(response.data);
}

export async function restartRunSession(id: string): Promise<RunSession> {
  const response = await apiClient.post<ApiSuccess<RunSession>>(`/runner/sessions/${id}/restart`);
  return unwrap(response.data);
}
