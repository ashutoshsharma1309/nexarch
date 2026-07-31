import type {
  ApiSuccess,
  ArchitecturePlan,
  DatabaseDesign,
  InsightsBundle,
  RequirementSpec,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export interface InsightsArtifactsInput {
  projectName: string;
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  databaseDesign: DatabaseDesign;
  quality?: { overallScore: number; grade: string };
}

export async function generateInsights(artifacts: InsightsArtifactsInput): Promise<InsightsBundle> {
  const response = await apiClient.post<ApiSuccess<InsightsBundle>>('/insights/generate', {
    artifacts,
  });
  return unwrap(response.data);
}
