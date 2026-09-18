/** Builder Agent API: start a task, follow it, cancel it. */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, BuilderSession } from '@/shared/types/api';

export async function startBuilderSession(task: string): Promise<BuilderSession> {
  const { data } = await apiClient.post<ApiSuccess<BuilderSession>>('/builder/sessions', { task });
  return unwrap(data);
}

export async function fetchBuilderSession(id: string): Promise<BuilderSession> {
  const { data } = await apiClient.get<ApiSuccess<BuilderSession>>(`/builder/sessions/${id}`);
  return unwrap(data);
}

export async function fetchBuilderSessions(): Promise<BuilderSession[]> {
  const { data } = await apiClient.get<ApiSuccess<BuilderSession[]>>('/builder/sessions');
  return unwrap(data);
}

export async function cancelBuilderSession(id: string): Promise<BuilderSession> {
  const { data } = await apiClient.post<ApiSuccess<BuilderSession>>(
    `/builder/sessions/${id}/cancel`,
  );
  return unwrap(data);
}
