/**
 * Agent orchestrator API.
 *
 * A separate surface from the pipeline's: the legacy path is untouched and
 * both can run, which is what makes the migration incremental rather than
 * a switch-over.
 */
import { apiClient, unwrap } from './api-client';
import type { AgentCatalogueEntry, AgentRunView, ApiSuccess } from '@/shared/types/api';

export async function startAgentRun(projectId: string, prompt: string): Promise<AgentRunView> {
  const { data } = await apiClient.post<ApiSuccess<AgentRunView>>(
    `/projects/${projectId}/agent-runs`,
    { prompt },
  );
  return unwrap(data);
}

export async function fetchAgentRun(projectId: string, runId: string): Promise<AgentRunView> {
  const { data } = await apiClient.get<ApiSuccess<AgentRunView>>(
    `/projects/${projectId}/agent-runs/${runId}`,
  );
  return unwrap(data);
}

export async function cancelAgentRun(projectId: string, runId: string): Promise<AgentRunView> {
  const { data } = await apiClient.post<ApiSuccess<AgentRunView>>(
    `/projects/${projectId}/agent-runs/${runId}/cancel`,
  );
  return unwrap(data);
}

export async function resumeAgentRun(projectId: string, runId: string): Promise<AgentRunView> {
  const { data } = await apiClient.post<ApiSuccess<AgentRunView>>(
    `/projects/${projectId}/agent-runs/${runId}/resume`,
  );
  return unwrap(data);
}

export async function fetchAgentCatalogue(projectId: string): Promise<AgentCatalogueEntry[]> {
  const { data } = await apiClient.get<ApiSuccess<AgentCatalogueEntry[]>>(
    `/projects/${projectId}/agent-runs/agents`,
  );
  return unwrap(data);
}
