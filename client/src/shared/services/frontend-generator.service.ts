import type {
  ApiSuccess,
  ArchitecturePlan,
  BackendManifest,
  DesignBundle,
  GeneratedFrontend,
  RequirementSpec,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

/** Generate a complete React + Vite frontend from the SDS and backend manifest. */
export async function generateFrontend(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  design: DesignBundle,
  backendManifest: BackendManifest,
): Promise<GeneratedFrontend> {
  const response = await apiClient.post<ApiSuccess<GeneratedFrontend>>('/frontend/generate', {
    architecture,
    requirements,
    databaseDesign: design.databaseDesign,
    openapi: design.openapi,
    backendManifest,
    entityMetadata: design.entityMetadata,
  });
  return unwrap(response.data);
}
