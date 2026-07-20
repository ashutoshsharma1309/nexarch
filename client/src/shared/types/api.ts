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

/* ── Database design (live endpoint: POST /database/design) ──────────── */

export interface ForeignKeyRef {
  table: string;
  column: string;
  onDelete: string;
}

export interface ColumnDesign {
  name: string;
  field: string;
  sqlType: string;
  prismaType: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  references?: ForeignKeyRef;
  enumValues?: string[];
  format?: string;
  nonNegative?: boolean;
  description: string;
}

export interface IndexDesign {
  name: string;
  columns: string[];
  unique: boolean;
  rationale: string;
}

export interface TableDesign {
  entity: string;
  tableName: string;
  columns: ColumnDesign[];
  primaryKey: string;
  indexes: IndexDesign[];
  softDelete: boolean;
  description: string;
}

export type RelationshipCardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface RelationshipDesign {
  name: string;
  cardinality: RelationshipCardinality;
  parent: string;
  child: string;
  foreignKey: string;
  onDelete: string;
  description: string;
}

export interface OptimizationReport {
  indexes: { table: string; columns: string[]; kind: string; reason: string }[];
  cachingCandidates: { table: string; reason: string }[];
  partitioningCandidates: { table: string; strategy: string; reason: string }[];
  queryGuidelines: string[];
}

export interface DatabaseDesign {
  meta: {
    projectName: string;
    projectType: string;
    engine: string;
    databaseVersion: string;
    normalForm: string;
    generatedAt: string;
    generator: string;
  };
  enums: { name: string; values: string[] }[];
  tables: TableDesign[];
  relationships: RelationshipDesign[];
  optimization: OptimizationReport;
}

export interface ErDiagram {
  nodes: {
    id: string;
    label: string;
    columns: {
      name: string;
      type: string;
      primaryKey: boolean;
      foreignKey: boolean;
      nullable: boolean;
    }[];
  }[];
  edges: {
    id: string;
    from: string;
    to: string;
    cardinality: RelationshipCardinality;
    label: string;
    foreignKey: string;
  }[];
}

export interface FieldValidation {
  field: string;
  type: string;
  rules: { rule: string; value?: string | number | string[]; message: string }[];
}

export interface ValidationRuleSet {
  meta: { projectName: string; generatedAt: string };
  entities: { entity: string; fields: FieldValidation[] }[];
}

export interface EntityMetadata {
  entity: string;
  tableName: string;
  description: string;
  ownership: string;
  permissions: { role: string; actions: string[] }[];
  lifecycle: string[];
  businessRules: string[];
  relationships: { related: string; cardinality: RelationshipCardinality; via: string }[];
}

export interface EntityMetadataSet {
  meta: { projectName: string; generatedAt: string };
  entities: EntityMetadata[];
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: Record<string, unknown>;
    parameters: Record<string, unknown>;
    responses: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security?: { bearerAuth: string[] }[];
  parameters?: { name: string; in: string; required: boolean; description: string }[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

export interface IntegrityReport {
  valid: boolean;
  issues: { severity: 'error' | 'warning'; location: string; message: string }[];
  stats: {
    tables: number;
    columns: number;
    relationships: number;
    indexes: number;
    enums: number;
    endpoints: number;
  };
}

export interface DesignBundle {
  databaseDesign: DatabaseDesign;
  prismaSchema: string;
  sqlSchema: string;
  erDiagram: ErDiagram;
  openapi: OpenApiDocument;
  validationRules: ValidationRuleSet;
  entityMetadata: EntityMetadataSet;
  integrity: IntegrityReport;
}

/* ── Generated backend (live endpoint: POST /backend/generate) ───────── */

export type FileLanguage =
  | 'typescript'
  | 'json'
  | 'markdown'
  | 'prisma'
  | 'env'
  | 'ignore'
  | 'javascript'
  | 'dockerfile'
  | 'html';

export interface GeneratedFile {
  path: string;
  content: string;
  language: FileLanguage;
}

export interface GeneratedRoute {
  method: string;
  path: string;
  handler: string;
  auth: boolean;
  implemented: boolean;
}

export interface GeneratedModuleSummary {
  name: string;
  entity: string | null;
  crud: boolean;
  endpoints: number;
  controller: string;
  service: string;
  repository: string | null;
  files: string[];
}

export interface GeneratedFolderNode {
  name: string;
  type: 'directory' | 'file';
  children?: GeneratedFolderNode[];
}

export interface GeneratedProject {
  meta: {
    projectName: string;
    projectType: string;
    framework: string;
    language: string;
    generatedAt: string;
    generator: string;
  };
  files: GeneratedFile[];
  modules: GeneratedModuleSummary[];
  routes: GeneratedRoute[];
  folderTree: GeneratedFolderNode[];
  stats: {
    files: number;
    modules: number;
    endpoints: number;
    implementedEndpoints: number;
    linesOfCode: number;
  };
}

/* ── Generated frontend (live endpoint: POST /frontend/generate) ─────── */

export type FrontendFileLanguage =
  | 'typescript'
  | 'typescriptreact'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'env'
  | 'ignore'
  | 'javascript';

export interface FrontendGeneratedFile {
  path: string;
  content: string;
  language: FrontendFileLanguage;
}

export interface FrontendPageSummary {
  name: string;
  route: string;
  kind: 'entity-list' | 'dashboard' | 'auth' | 'settings' | 'profile' | 'not-found';
  entity: string | null;
  implemented: boolean;
  files: string[];
}

export interface FrontendComponentSummary {
  name: string;
  kind: 'ui' | 'layout' | 'feature';
  file: string;
}

export interface FrontendRouteSummary {
  path: string;
  page: string;
  protected: boolean;
  lazy: boolean;
}

export interface FrontendStoreSummary {
  name: string;
  file: string;
  persisted: boolean;
}

export interface GeneratedFrontend {
  meta: {
    projectName: string;
    projectType: string;
    framework: string;
    language: string;
    generatedAt: string;
    generator: string;
  };
  files: FrontendGeneratedFile[];
  pages: FrontendPageSummary[];
  components: FrontendComponentSummary[];
  routes: FrontendRouteSummary[];
  stores: FrontendStoreSummary[];
  folderTree: GeneratedFolderNode[];
  stats: {
    files: number;
    pages: number;
    components: number;
    routes: number;
    stores: number;
    linesOfCode: number;
  };
}

export interface BackendManifest {
  modules: { name: string; entity: string | null; crud: boolean; endpoints: number }[];
  routes: { method: string; path: string; implemented: boolean }[];
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
