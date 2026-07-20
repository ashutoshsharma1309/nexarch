import type {
  ApiSuccess,
  ArchitecturePlan,
  DesignBundle,
  GeneratedProject,
  RequirementSpec,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

/** Generate a complete Express + TypeScript + Prisma backend from the SDS. */
export async function generateBackend(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  design: DesignBundle,
): Promise<GeneratedProject> {
  const response = await apiClient.post<ApiSuccess<GeneratedProject>>('/backend/generate', {
    architecture,
    requirements,
    databaseDesign: design.databaseDesign,
    prismaSchema: design.prismaSchema,
    openapi: design.openapi,
    validationRules: design.validationRules,
    entityMetadata: design.entityMetadata,
  });
  return unwrap(response.data);
}
