import type {
  ApiSuccess,
  ArchitecturePlan,
  DependencyGraphBundle,
  DesignBundle,
  FrontendManifest,
  GeneratedFile,
  GeneratedProject,
  GeneratedFrontend,
  ImpactAnalysis,
  RegenerationResult,
  RequirementSpec,
  SecurityBundle,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

interface BackendBundlePayload {
  files: GeneratedFile[];
  modules: GeneratedProject['modules'];
  routes: GeneratedProject['routes'];
}

interface FrontendBundlePayload {
  files: GeneratedFrontend['files'];
  pages: GeneratedFrontend['pages'];
  components: GeneratedFrontend['components'];
  routes: GeneratedFrontend['routes'];
  stores: GeneratedFrontend['stores'];
}

interface SecurityBundlePayload {
  backendFiles: SecurityBundle['backendFiles'];
  frontendFiles: SecurityBundle['frontendFiles'];
  rbac: SecurityBundle['rbac'];
}

export function toBackendBundle(backend: GeneratedProject): BackendBundlePayload {
  return { files: backend.files, modules: backend.modules, routes: backend.routes };
}

export function toFrontendBundle(frontend: GeneratedFrontend): FrontendBundlePayload {
  return {
    files: frontend.files,
    pages: frontend.pages,
    components: frontend.components,
    routes: frontend.routes,
    stores: frontend.stores,
  };
}

export function toSecurityBundle(security: SecurityBundle): SecurityBundlePayload {
  return {
    backendFiles: security.backendFiles,
    frontendFiles: security.frontendFiles,
    rbac: security.rbac,
  };
}

interface GraphRequestBody {
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  databaseDesign: DesignBundle['databaseDesign'];
  backend: BackendBundlePayload;
  frontend: FrontendBundlePayload;
  security: SecurityBundlePayload;
}

function requestBody(
  requirements: RequirementSpec,
  architecture: ArchitecturePlan,
  design: DesignBundle,
  backend: GeneratedProject,
  frontend: GeneratedFrontend,
  security: SecurityBundle,
): GraphRequestBody {
  return {
    requirements,
    architecture,
    databaseDesign: design.databaseDesign,
    backend: toBackendBundle(backend),
    frontend: toFrontendBundle(frontend),
    security: toSecurityBundle(security),
  };
}

/** Build the dependency graph from the full pipeline output. */
export async function buildDependencyGraph(
  requirements: RequirementSpec,
  architecture: ArchitecturePlan,
  design: DesignBundle,
  backend: GeneratedProject,
  frontend: GeneratedFrontend,
  security: SecurityBundle,
): Promise<DependencyGraphBundle> {
  const response = await apiClient.post<ApiSuccess<DependencyGraphBundle>>(
    '/dependency/build',
    requestBody(requirements, architecture, design, backend, frontend, security),
  );
  return unwrap(response.data);
}

/** Analyze a natural-language change request against the current graph — no files generated. */
export async function analyzeChangeImpact(
  changeRequest: string,
  requirements: RequirementSpec,
  architecture: ArchitecturePlan,
  design: DesignBundle,
  backend: GeneratedProject,
  frontend: GeneratedFrontend,
  security: SecurityBundle,
): Promise<ImpactAnalysis> {
  const response = await apiClient.post<ApiSuccess<ImpactAnalysis>>('/dependency/analyze', {
    ...requestBody(requirements, architecture, design, backend, frontend, security),
    changeRequest,
  });
  return unwrap(response.data);
}

export interface RegenerateOptions {
  manualEdits?: Record<string, string>;
}

/** Merge a freshly regenerated project with the previous one, touching only the affected files. */
export async function regenerateProject(
  changeRequest: string,
  requirements: RequirementSpec,
  architecture: ArchitecturePlan,
  design: DesignBundle,
  backend: GeneratedProject,
  frontend: GeneratedFrontend,
  security: SecurityBundle,
  newBackend: GeneratedProject,
  newFrontend: GeneratedFrontend,
  newSecurity: SecurityBundle,
  options: RegenerateOptions = {},
): Promise<RegenerationResult> {
  const response = await apiClient.post<ApiSuccess<RegenerationResult>>('/dependency/regenerate', {
    ...requestBody(requirements, architecture, design, backend, frontend, security),
    changeRequest,
    newBackend: toBackendBundle(newBackend),
    newFrontend: toFrontendBundle(newFrontend),
    newSecurity: toSecurityBundle(newSecurity),
    manualEdits: options.manualEdits,
  });
  return unwrap(response.data);
}

export type { FrontendManifest };
