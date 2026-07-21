import type {
  AiCostAnalytics,
  AiGenerateResponse,
  AiGenerationRecord,
  AiTaskComplexity,
  AiWorkflowRun,
  ApiSuccess,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export interface GenerateOptions {
  promptId: string;
  variables: Record<string, string>;
  complexity: AiTaskComplexity;
  schema?: 'requirement-spec' | 'architecture-plan' | 'database-design' | 'generic-json';
}

export async function generate(options: GenerateOptions): Promise<AiGenerateResponse> {
  const response = await apiClient.post<ApiSuccess<AiGenerateResponse>>('/ai/generate', options);
  return unwrap(response.data);
}

export async function retryGeneration(options: GenerateOptions): Promise<AiGenerateResponse> {
  const response = await apiClient.post<ApiSuccess<AiGenerateResponse>>('/ai/retry', options);
  return unwrap(response.data);
}

export interface WorkflowStepPayload {
  name: string;
  variables?: Record<string, string>;
  completed?: boolean;
}

export async function runWorkflow(
  workflowId: string,
  steps: WorkflowStepPayload[],
): Promise<AiWorkflowRun> {
  const response = await apiClient.post<ApiSuccess<AiWorkflowRun>>('/ai/workflow', {
    workflowId,
    steps,
  });
  return unwrap(response.data);
}

export async function getHistory(limit?: number): Promise<AiGenerationRecord[]> {
  const response = await apiClient.get<ApiSuccess<AiGenerationRecord[]>>('/ai/history', {
    params: limit ? { limit } : undefined,
  });
  return unwrap(response.data);
}

export async function getStatistics(): Promise<AiCostAnalytics> {
  const response = await apiClient.get<ApiSuccess<AiCostAnalytics>>('/ai/statistics');
  return unwrap(response.data);
}
