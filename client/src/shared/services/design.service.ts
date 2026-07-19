import type {
  ApiSuccess,
  ArchitecturePlan,
  DesignBundle,
  RequirementSpec,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

/** Produce the full design bundle (schemas, ER, OpenAPI, validation, metadata). */
export async function designDatabase(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
): Promise<DesignBundle> {
  const response = await apiClient.post<ApiSuccess<DesignBundle>>('/database/design', {
    architecture,
    requirements,
  });
  return unwrap(response.data);
}
