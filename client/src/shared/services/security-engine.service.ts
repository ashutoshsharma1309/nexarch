import type {
  ApiSuccess,
  ArchitecturePlan,
  BackendManifest,
  DesignBundle,
  FrontendManifest,
  RequirementSpec,
  SecurityBundle,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

interface SecurityRequestBody {
  architecture: ArchitecturePlan;
  requirements: RequirementSpec;
  databaseDesign: DesignBundle['databaseDesign'];
  openapi: DesignBundle['openapi'];
  entityMetadata: DesignBundle['entityMetadata'];
  backendManifest: BackendManifest;
  frontendManifest: FrontendManifest;
}

function requestBody(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  design: DesignBundle,
  backendManifest: BackendManifest,
  frontendManifest: FrontendManifest,
): SecurityRequestBody {
  return {
    architecture,
    requirements,
    databaseDesign: design.databaseDesign,
    openapi: design.openapi,
    entityMetadata: design.entityMetadata,
    backendManifest,
    frontendManifest,
  };
}

/** Analyze security posture only — no files generated, just the audit + OWASP report + score. */
export async function analyzeSecurity(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  design: DesignBundle,
  backendManifest: BackendManifest,
  frontendManifest: FrontendManifest,
): Promise<{
  report: SecurityBundle['report'];
  owasp: SecurityBundle['owasp'];
  recommendations: string[];
}> {
  const response = await apiClient.post<
    ApiSuccess<{
      report: SecurityBundle['report'];
      owasp: SecurityBundle['owasp'];
      recommendations: string[];
    }>
  >(
    '/security/analyze',
    requestBody(architecture, requirements, design, backendManifest, frontendManifest),
  );
  return unwrap(response.data);
}

/** Analyze and generate every security fix the engine can produce — the full bundle. */
export async function applySecurity(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  design: DesignBundle,
  backendManifest: BackendManifest,
  frontendManifest: FrontendManifest,
): Promise<SecurityBundle> {
  const response = await apiClient.post<ApiSuccess<SecurityBundle>>(
    '/security/apply',
    requestBody(architecture, requirements, design, backendManifest, frontendManifest),
  );
  return unwrap(response.data);
}
