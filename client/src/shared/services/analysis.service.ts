import type { AnalysisResult, ApiSuccess } from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

/** Analyze a natural-language requirement prompt into a structured spec. */
export async function analyzePrompt(prompt: string): Promise<AnalysisResult> {
  const response = await apiClient.post<ApiSuccess<AnalysisResult>>('/analyze', { prompt });
  return unwrap(response.data);
}
