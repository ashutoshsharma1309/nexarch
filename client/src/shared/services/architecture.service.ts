import type { ApiSuccess, ArchitectureResponse, RequirementSpec } from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

/** Produce a Software Design Specification from a requirement spec. */
export async function planArchitecture(spec: RequirementSpec): Promise<ArchitectureResponse> {
  const response = await apiClient.post<ApiSuccess<ArchitectureResponse>>('/architecture', spec);
  return unwrap(response.data);
}
