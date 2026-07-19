/**
 * Client-side mirror of the server's API contract
 * (`server/src/shared/types/api.ts`) plus the domain types Phase 1 renders.
 * If the envelope changes on the server, it changes here in the same commit.
 */

export interface ApiMeta {
  requestId: string;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
  meta: ApiMeta;
}

/* ── Health (live endpoint) ──────────────────────────────────────────── */

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latencyMs?: number;
      error?: string;
    };
  };
}

/* ── Domain (rendered in Phase 1, served from Phase 2) ───────────────── */

export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/* ── Requirement analysis (live endpoint: POST /analyze) ─────────────── */

export interface RequirementSpec {
  projectName: string;
  projectType: string;
  roles: string[];
  modules: string[];
  frontend: string[];
  backend: string[];
  database: string[];
  authentication: string[];
  integrations: string[];
  missingRequirements: string[];
}

export type DetectionConfidence = 'high' | 'medium' | 'low';

export interface DetectionSummary {
  projectType: string | null;
  confidence: DetectionConfidence;
  matchedSignals: string[];
}

export type AnalysisResult =
  | { status: 'COMPLETE'; spec: RequirementSpec; detection: DetectionSummary }
  | { status: 'INCOMPLETE'; questions: string[]; detection: DetectionSummary };

/* ── Architecture plan (live endpoint: POST /architecture) ───────────── */

export interface ArchitectureDecision {
  choice: string;
  reasoning: string;
  alternatives: { option: string; rejectedBecause: string }[];
}

export interface FolderNode {
  name: string;
  type: 'directory' | 'file';
  children?: FolderNode[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  description: string;
  auth: boolean;
  roles?: string[];
}

export interface ApiModulePlan {
  module: string;
  basePath: string;
  endpoints: ApiEndpoint[];
}

export interface EntityPlan {
  name: string;
  tableName: string;
  primaryKey: string;
  keyFields: string[];
  relations: { type: string; target: string; foreignKey: string }[];
  indexes: string[];
}

export interface NfrScore {
  score: number;
  notes: string;
}

export interface ArchitecturePlan {
  meta: { projectName: string; projectType: string; generatedAt: string; planner: string };
  decisions: {
    architecture: ArchitectureDecision;
    frontendArchitecture: ArchitectureDecision;
    backendArchitecture: ArchitectureDecision;
    database: ArchitectureDecision;
    authentication: ArchitectureDecision;
  };
  folderStructure: FolderNode[];
  apiModules: ApiModulePlan[];
  frontend: {
    pages: { name: string; route: string; layout: string; access: string[] }[];
    layouts: string[];
    navigation: { label: string; route: string; roles: string[] }[];
    dashboardWidgets: { name: string; description: string }[];
    reusableComponents: string[];
  };
  database: { engine: string; entities: EntityPlan[]; normalization: string[] };
  services: {
    module: string;
    controller: string;
    service: string;
    repository: string;
    dtos: string[];
    validators: string[];
  }[];
  middleware: { name: string; purpose: string }[];
  security: {
    authentication: string[];
    sessionStrategy: string;
    authorization: string;
    passwordPolicy: string[];
    rateLimiting: string[];
    validation: string;
    headers: string[];
    cors: string;
  };
  dependencyGraph: {
    nodes: { id: string; label: string }[];
    edges: { from: string; to: string; reason: string }[];
  };
  futureScalability: { concern: string; recommendation: string; trigger: string }[];
  nonFunctional: {
    performance: NfrScore;
    maintainability: NfrScore;
    security: NfrScore;
    scalability: NfrScore;
    availability: NfrScore;
    reliability: NfrScore;
  };
}

export interface ArchitectureResponse {
  plan: ArchitecturePlan;
  markdown: string;
}

export type GenerationStatus =
  'PENDING' | 'ANALYZING' | 'PLANNING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';

export interface Generation {
  id: string;
  projectId: string;
  prompt: string;
  status: GenerationStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
