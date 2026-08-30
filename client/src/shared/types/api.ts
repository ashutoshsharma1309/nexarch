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
  /** Owning user — projects became owner-scoped in v2 Phase 1. */
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One execution of the generation pipeline, owned by a project. */
export type RunStatus =
  'PENDING' | 'ANALYZING' | 'PLANNING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';

export interface Run {
  id: string;
  projectId: string;
  prompt: string;
  status: RunStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
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

/* ── Security bundle (live endpoints: POST /security/analyze, /apply) ── */

export type SecurityFileLanguage =
  'typescript' | 'typescriptreact' | 'json' | 'markdown' | 'env' | 'javascript';

export interface SecurityGeneratedFile {
  path: string;
  content: string;
  language: SecurityFileLanguage;
}

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  category: string;
  owasp: string | null;
  title: string;
  description: string;
  location: string | null;
  recommendation: string;
  resolved: boolean;
}

export interface EndpointSecurityAssessment {
  method: string;
  path: string;
  module: string;
  authRequired: boolean;
  rolesRequired: string[];
  validated: boolean;
  rateLimited: boolean;
  sensitiveData: boolean;
  notes: string[];
}

export type OwaspStatus = 'pass' | 'warn' | 'fail' | 'not-applicable';

export interface OwaspCategoryResult {
  id: string;
  title: string;
  status: OwaspStatus;
  summary: string;
  findingIds: string[];
}

export interface OwaspReport {
  version: '2021';
  categories: OwaspCategoryResult[];
  passed: number;
  warned: number;
  failed: number;
  notApplicable: number;
}

export interface SecurityReport {
  meta: { projectName: string; projectType: string; generatedAt: string; generator: string };
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: { critical: number; high: number; medium: number; low: number; resolved: number };
  findings: SecurityFinding[];
  resolvedFindings: SecurityFinding[];
  recommendations: string[];
  endpoints: EndpointSecurityAssessment[];
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  passwordHistory: number;
  expirationDays: number | null;
  bcryptSaltRounds: number;
}

export interface FileSecurityPolicy {
  maxSizeMb: number;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  virusScanEnabled: boolean;
}

export type RbacAction = 'create' | 'read' | 'update' | 'delete';

export interface RbacRoleDefinition {
  role: string;
  description: string;
}

export interface RbacPermissionEntry {
  entity: string;
  role: string;
  actions: RbacAction[];
}

export interface RbacConfig {
  roles: RbacRoleDefinition[];
  permissions: RbacPermissionEntry[];
}

export interface JwtConfig {
  algorithm: 'HS256';
  issuer: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
  refreshTokenStrategy: string;
}

export interface SecurityConfig {
  jwt: JwtConfig;
  passwordPolicy: PasswordPolicy;
  fileSecurity: FileSecurityPolicy;
  cors: { allowedOrigins: string[]; credentials: boolean };
  rateLimits: { windowMs: number; authMax: number; apiMax: number; writeMax: number };
  headers: string[];
  csrfEnabled: boolean;
  secureCookies: boolean;
}

export interface SecurityStats {
  backendFiles: number;
  frontendFiles: number;
  findings: number;
  resolved: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  owaspPassed: number;
  owaspTotal: number;
  identityTableDetected: string | null;
}

export interface SecurityBundle {
  meta: { projectName: string; projectType: string; generatedAt: string; generator: string };
  backendFiles: SecurityGeneratedFile[];
  frontendFiles: SecurityGeneratedFile[];
  report: SecurityReport;
  owasp: OwaspReport;
  rbac: RbacConfig;
  permissions: RbacPermissionEntry[];
  passwordPolicy: PasswordPolicy;
  fileSecurity: FileSecurityPolicy;
  securityConfig: SecurityConfig;
  folderTree: GeneratedFolderNode[];
  stats: SecurityStats;
}

export interface FrontendManifest {
  pages: {
    name: string;
    route: string;
    kind: string;
    entity: string | null;
    implemented: boolean;
  }[];
}

/* ── Dependency graph (live endpoints: POST /dependency/build, /analyze, /regenerate) ── */

export type NodeType =
  | 'page'
  | 'component'
  | 'hook'
  | 'store'
  | 'api-endpoint'
  | 'route'
  | 'controller'
  | 'service'
  | 'repository'
  | 'db-table'
  | 'prisma-model'
  | 'middleware'
  | 'config'
  | 'utility'
  | 'env-var'
  | 'security-module';

export type ModuleGroup = 'frontend' | 'backend' | 'database' | 'security' | 'shared';

export type EdgeType =
  | 'imports'
  | 'renders'
  | 'calls-api'
  | 'implements-route'
  | 'invokes'
  | 'queries'
  | 'maps-to'
  | 'authenticates'
  | 'authorizes'
  | 'validates'
  | 'reads-config'
  | 'depends-on';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  group: ModuleGroup;
  file: string | null;
  meta: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  label?: string;
}

export interface DependencyGraph {
  meta: {
    projectName: string;
    projectType: string;
    generatedAt: string;
    generator: string;
    sources: string[];
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    nodeCount: number;
    edgeCount: number;
    nodesByGroup: Record<ModuleGroup, number>;
    edgesByType: Partial<Record<EdgeType, number>>;
  };
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  group: ModuleGroup;
  type: NodeType;
}

export interface LayoutGroup {
  id: ModuleGroup;
  label: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  groups: LayoutGroup[];
  edges: { id: string; from: string; to: string; type: EdgeType }[];
}

export interface CircularDependency {
  cycle: string[];
  length: number;
}

export interface DuplicateGroup {
  kind: 'component' | 'service';
  label: string;
  nodeIds: string[];
}

export interface ArchitectureViolation {
  severity: 'high' | 'medium' | 'low';
  rule: string;
  description: string;
  nodeIds: string[];
}

export interface QualityReport {
  circularDependencies: CircularDependency[];
  orphanFiles: string[];
  unusedComponents: string[];
  deadRoutes: string[];
  duplicateGroups: DuplicateGroup[];
  architectureViolations: ArchitectureViolation[];
  recommendations: string[];
}

export interface DependencyStats {
  totalNodes: number;
  totalEdges: number;
  averageDependencyDepth: number;
  maxDependencyDepth: number;
  circularDependencyCount: number;
  orphanFileCount: number;
  nodesByGroup: Record<ModuleGroup, number>;
  nodesByType: Partial<Record<NodeType, number>>;
}

export interface DependencyGraphBundle {
  meta: DependencyGraph['meta'];
  graph: DependencyGraph;
  layout: GraphLayout;
  stats: DependencyStats;
  quality: QualityReport;
}

export interface ChangeClassification {
  category: string;
  keywords: string[];
  confidence: number;
  seedNodeIds: string[];
}

export interface AffectedFile {
  path: string;
  group: ModuleGroup;
  reason: string;
  nodeId: string;
}

export interface TokenOptimization {
  fullProjectFiles: number;
  fullProjectTokensEstimate: number;
  affectedFiles: number;
  affectedTokensEstimate: number;
  duplicatesRemoved: number;
  tokensSaved: number;
  savingsPercent: number;
  estimatedCostSavedUsd: number;
}

export interface ImpactAnalysis {
  meta: { projectName: string; generatedAt: string; generator: string };
  changeRequest: string;
  classification: ChangeClassification;
  affectedNodeIds: string[];
  affectedFiles: AffectedFile[];
  modulesAffected: {
    frontend: string[];
    backend: string[];
    database: string[];
    security: string[];
    configuration: string[];
  };
  unaffectedFileCount: number;
  tokenOptimization: TokenOptimization;
}

export type FileProvenance = 'regenerated' | 'preserved' | 'manual';

export interface MergedFile {
  path: string;
  content: string;
  language: string;
  provenance: FileProvenance;
}

export interface MergeStats {
  regenerated: number;
  preserved: number;
  manual: number;
  total: number;
}

export interface VersionRecord {
  version: number;
  createdAt: string;
  changeRequest: string | null;
  filesRegenerated: string[];
  filesPreserved: string[];
  filesManual: string[];
  summary: string;
}

export interface ProjectManifest {
  projectName: string;
  currentVersion: number;
  versions: VersionRecord[];
}

export interface RegenerationResult {
  meta: { projectName: string; generatedAt: string; generator: string };
  files: MergedFile[];
  stats: MergeStats;
  manifest: ProjectManifest;
  folderTree: GeneratedFolderNode[];
}

/* ── AI Orchestrator (live endpoints: POST /ai/generate, /retry, /workflow, GET /history, /statistics) ── */

export type AiProviderId = 'claude' | 'openai' | 'gemini' | 'openrouter' | 'mock';
export type AiTaskComplexity =
  'simple-extraction' | 'large-planning' | 'small-file-regen' | 'complex-refactor';

export interface AiModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCostEstimate {
  provider: AiProviderId;
  model: string;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export interface AiValidationIssue {
  path: string;
  message: string;
  kind: 'missing' | 'type-mismatch' | 'hallucinated' | 'incomplete';
}

export interface AiValidationResult {
  valid: boolean;
  issues: AiValidationIssue[];
}

export type AiGenerationStatus = 'success' | 'failed' | 'cached';

export interface AiGenerationRecord {
  id: string;
  timestamp: string;
  promptId: string;
  provider: AiProviderId;
  model: string;
  complexity: AiTaskComplexity;
  tokens: AiModelUsage;
  cost: AiCostEstimate;
  durationMs: number;
  status: AiGenerationStatus;
  cacheHit: boolean;
  retries: number;
  validation: AiValidationResult;
  version: number;
  error?: string;
}

export interface AiContextPackage {
  summary: string;
  manifestReferences: string[];
  files: { path: string; content: string }[];
  estimatedTokens: number;
  truncated: boolean;
  omittedFiles: string[];
}

export interface AiCompressionResult {
  text: string;
  originalTokens: number;
  compressedTokens: number;
  savingsPercent: number;
}

export interface AiGenerateResponse {
  record: AiGenerationRecord;
  content: string;
  contextPackage: AiContextPackage | null;
  compression: AiCompressionResult | null;
}

export type AiWorkflowStepKind = 'ai' | 'pipeline-reference';
export type AiWorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface AiWorkflowStepResult {
  name: string;
  kind: AiWorkflowStepKind;
  status: AiWorkflowStepStatus;
  durationMs: number;
  generationId?: string;
  error?: string;
}

export interface AiWorkflowRun {
  id: string;
  workflowId: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  steps: AiWorkflowStepResult[];
}

export interface AiCacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface AiCostAnalytics {
  totalGenerations: number;
  totalTokens: number;
  averageTokens: number;
  totalCostUsd: number;
  averageCostUsd: number;
  averageDurationMs: number;
  cache: AiCacheStats;
  byProvider: Partial<
    Record<AiProviderId, { generations: number; tokens: number; costUsd: number }>
  >;
  byComplexity: Partial<Record<AiTaskComplexity, number>>;
}

export type GenerationStatus =
  'PENDING' | 'ANALYZING' | 'PLANNING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';

export interface Generation {
  id: string;
  projectId: string;
  prompt: string;
  status: GenerationStatus;
  model: string | null;
  tokensUsed: number | null;
  costUsd: number | null;
  durationMs: number | null;
  filesGenerated: number | null;
  filesModified: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/* ── Workspace: projects, generation history, activity, documentation,
   export (Phase 10) ──────────────────────────────────────────────────── */

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  favorite?: boolean;
}

export type ActivityEventType =
  | 'project.created'
  | 'project.renamed'
  | 'project.updated'
  | 'project.archived'
  | 'project.unarchived'
  | 'project.favorited'
  | 'project.unfavorited'
  | 'project.duplicated'
  | 'project.deleted'
  | 'generation.logged'
  | 'export.completed'
  | 'documentation.generated';

export interface ActivityLogEntry {
  id: string;
  type: ActivityEventType;
  projectId: string | null;
  projectName: string | null;
  message: string;
  createdAt: string;
}

export interface ProjectDashboard {
  project: Project;
  generations: Generation[];
  latestGeneration: Generation | null;
  activity: ActivityLogEntry[];
  stats: {
    totalGenerations: number;
    completedGenerations: number;
    failedGenerations: number;
  };
}

export interface WorkspaceStatistics {
  totalProjects: number;
  activeProjects: number;
  archivedProjects: number;
  favoriteProjects: number;
  totalGenerations: number;
}

export interface WorkspaceHistory {
  generations: Generation[];
  activity: ActivityLogEntry[];
}

/** Everything documentation/export can draw on — all optional since a
 * project may be at any pipeline stage. Assembled client-side from
 * whatever pipeline data is currently in React Query's cache. */
export interface ProjectArtifacts {
  projectName: string;
  requirements?: RequirementSpec;
  architecture?: ArchitecturePlan;
  databaseDesign?: DatabaseDesign;
  prismaSchema?: string;
  sqlSchema?: string;
  openapi?: OpenApiDocument;
  backend?: {
    files: { path: string; content?: string }[];
    modules: string[];
    routes: { method: string; path: string }[];
  };
  frontend?: {
    files: { path: string; content?: string }[];
    pages: { name: string; route: string }[];
    components: string[];
  };
  security?: {
    report: SecurityReport;
    owasp: OwaspReport;
    stats: SecurityStats;
  };
  dependencyGraph?: {
    stats: DependencyStats;
    quality: { recommendations: string[] };
  };
}

export type DocumentationType =
  | 'readme'
  | 'api'
  | 'architecture'
  | 'database'
  | 'security'
  | 'deployment-guide'
  | 'developer-guide';

export interface DocumentationResult {
  type: DocumentationType;
  filename: string;
  markdown: string;
}

export type ExportFormat =
  | 'zip-project'
  | 'docker-package'
  | 'readme'
  | 'openapi'
  | 'postman-collection'
  | 'prisma-schema'
  | 'sql-schema'
  | 'architecture-report'
  | 'dependency-graph'
  | 'security-report'
  | 'project-manifest';

export interface ExportFile {
  path: string;
  content: string;
}

export type ExportResult =
  | { kind: 'file'; filename: string; mimeType: string; content: string }
  | { kind: 'archive'; files: ExportFile[] };

/* ── Deployment (Phase 11) ────────────────────────────────────────────── */

export type DeploymentTarget =
  | 'docker'
  | 'docker-compose'
  | 'vercel'
  | 'netlify'
  | 'render'
  | 'railway'
  | 'aws-ec2'
  | 'aws-ecs'
  | 'gcp-cloud-run'
  | 'azure-app-service'
  | 'digitalocean'
  | 'local';

export type DeploymentFileLanguage =
  'dockerfile' | 'yaml' | 'shellscript' | 'ignore' | 'env' | 'markdown' | 'json' | 'typescript';

export interface DeploymentFile {
  path: string;
  content: string;
  language: DeploymentFileLanguage;
}

export interface EnvVarRule {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
  example: string;
}

export interface DeploymentBundle {
  target: DeploymentTarget;
  meta: { projectName: string; generatedAt: string; generator: string };
  docker: {
    dockerignoreBackend: DeploymentFile;
    dockerignoreFrontend: DeploymentFile;
    composeDev: DeploymentFile;
    composeProd: DeploymentFile;
  };
  environment: {
    envExample: DeploymentFile;
    envDevelopment: DeploymentFile;
    envProduction: DeploymentFile;
    validationRules: EnvVarRule[];
    docs: DeploymentFile;
  };
  cicd: { buildWorkflow: DeploymentFile; deployWorkflow: DeploymentFile };
  health: { files: DeploymentFile[] };
  monitoring: { files: DeploymentFile[] };
  logging: { files: DeploymentFile[] };
  backup: { markdown: string };
  scalability: { markdown: string };
  targetConfig: { files: DeploymentFile[] };
  guide: { markdown: string };
}

export type DeploymentExportFormat =
  | 'dockerfile'
  | 'docker-compose'
  | 'docker-compose-prod'
  | 'github-workflow-build'
  | 'github-workflow-deploy'
  | 'env-example'
  | 'deployment-guide'
  | 'complete-zip'
  | 'docker-package'
  | 'deployment-package'
  | 'environment-package'
  | 'cicd-package';

export interface DeploymentStatus {
  supportedTargets: DeploymentTarget[];
  ready: boolean;
  capabilities: string[];
}

export interface DeploymentHealthCheckPreview {
  path: string;
  purpose: string;
}

export interface DeploymentHealthPreview {
  status: 'ok';
  note: string;
  checks: DeploymentHealthCheckPreview[];
  generatedAt: string;
}

/* ── Quality Assurance, Testing, Benchmarking & Documentation (Phase 12) ─ */

/** Sent as the request body's `artifacts` — the same `ProjectArtifacts`
 * object already assembled for Documentation/Export/Deployment, plus the
 * AI Orchestrator's own aggregate stats and a client-known deployment flag
 * neither of which `ProjectArtifacts` carries. */
export type QualityArtifacts = ProjectArtifacts & {
  aiStats?: {
    totalGenerations: number;
    totalTokens: number;
    totalCostUsd: number;
    averageDurationMs: number;
    cache: { hitRate: number };
  };
  deploymentConfigured?: boolean;
};

export type TestFileKind =
  'unit' | 'integration' | 'api' | 'component' | 'e2e' | 'regression' | 'smoke';

export interface TestFile {
  path: string;
  content: string;
  language: 'typescript' | 'json' | 'markdown';
  kind: TestFileKind;
}

export interface OpenApiValidationResult {
  valid: boolean;
  issues: string[];
  endpointsCovered: number;
}

export interface TestingReport {
  files: TestFile[];
  summary: { kind: TestFileKind; fileCount: number; caseCount: number }[];
  coverageEstimatePercent: number;
  openApiValidation: OpenApiValidationResult;
}

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface QualityIssue {
  severity: IssueSeverity;
  category: string;
  location: string;
  message: string;
}

export interface QualityMetric {
  name: string;
  value: number;
  unit: string;
  status: 'good' | 'warning' | 'critical';
}

export interface CodeQualityReport {
  metrics: QualityMetric[];
  issues: QualityIssue[];
  duplication: { duplicateGroups: number; affectedFiles: number };
  complexity: { averageScore: number; highestFile: string | null; highestScore: number };
  deadCode: { unusedComponents: string[]; deadRoutes: string[]; orphanFiles: string[] };
  circularDependencies: number;
  largeFiles: { path: string; lines: number }[];
  score: number;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  estimated: boolean;
}

export interface PerformanceReport {
  metrics: PerformanceMetric[];
  bundleSizeEstimateKb: number;
  buildTimeEstimateSeconds: number;
  tokenConsumption: { totalTokens: number; totalCostUsd: number; averageDurationMs: number } | null;
  cacheHitRate: number | null;
  recommendations: string[];
  score: number;
}

export interface SecurityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SecurityValidationReport {
  checks: SecurityCheck[];
  owaspCompliance: { passed: number; total: number };
  secretsDetected: string[];
  score: number;
}

export interface ArchitectureCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ArchitectureValidationReport {
  checks: ArchitectureCheck[];
  violations: string[];
  score: number;
}

export type DocumentationFileKind =
  | 'readme'
  | 'system-architecture'
  | 'api-documentation'
  | 'database-documentation'
  | 'security-guide'
  | 'deployment-guide'
  | 'developer-guide'
  | 'contributing'
  | 'changelog'
  | 'license';

export interface QualityDocumentationFile {
  kind: DocumentationFileKind;
  filename: string;
  content: string;
}

export interface QualityDocumentationBundle {
  files: QualityDocumentationFile[];
}

export type EngineeringGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export type ScoreCategory =
  | 'architecture'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'scalability'
  | 'testing'
  | 'documentation'
  | 'deployment'
  | 'developerExperience';

export interface CategoryScore {
  category: ScoreCategory;
  score: number;
  grade: EngineeringGrade;
  notes: string[];
}

export interface EngineeringScore {
  overall: number;
  grade: EngineeringGrade;
  categories: CategoryScore[];
  recommendations: string[];
  generatedAt: string;
}

export interface BenchmarkComparison {
  dimension: string;
  nexarch: string;
  traditionalCrud: string;
  basicAiGeneration: string;
  architectureFirstGeneration: string;
}

export interface BenchmarkReport {
  comparisons: BenchmarkComparison[];
  summary: string;
  methodology: string;
}

export type ReadinessTier = 'development' | 'testing' | 'production' | 'enterprise';

export interface ReadinessCheck {
  name: string;
  tier: ReadinessTier;
  passed: boolean;
}

export interface ReleaseReadiness {
  tier: ReadinessTier;
  checks: ReadinessCheck[];
  recommendations: string[];
}

export interface EngineeringBundle {
  meta: { projectName: string; generatedAt: string; generator: string };
  quality: CodeQualityReport;
  performance: PerformanceReport;
  security: SecurityValidationReport;
  architecture: ArchitectureValidationReport;
  testingSummary: TestingReport['summary'];
  testingCoverageEstimatePercent: number;
  score: EngineeringScore;
  benchmark: BenchmarkReport;
  readiness: ReleaseReadiness;
}

export type QualityExportFormat =
  | 'quality-report'
  | 'testing-report'
  | 'benchmark-report'
  | 'engineering-score'
  | 'release-readiness'
  | 'readme'
  | 'documentation-package';

/* ── Insights: automatic architecture analysis (Phase 13) ─────────────── */

export interface TechnologyJustification {
  question: string;
  technology: string;
  layer: 'frontend' | 'backend' | 'database' | 'authentication' | 'infrastructure';
  reasoning: string;
  alternatives: { option: string; rejectedBecause: string }[];
}

export interface InsightsDiagram {
  title: string;
  mermaid: string;
}

export interface InsightScore {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  reasoning: string[];
}

export interface InsightsBundle {
  meta: { projectName: string; projectType: string; generatedAt: string; generator: string };
  summary: string;
  technologyJustifications: TechnologyJustification[];
  explanations: { folders: string; database: string; api: string; security: string };
  diagrams: { architecture: InsightsDiagram; er: InsightsDiagram; apiFlow: InsightsDiagram };
  scores: {
    maintainability: InsightScore;
    security: InsightScore;
    scalability: InsightScore;
    overall: InsightScore;
  };
}

/* ── Dependency graph: prompt-diff regeneration (Phase 13) ────────────── */

export type SpecCategory =
  'roles' | 'modules' | 'frontend' | 'backend' | 'database' | 'authentication' | 'integrations';

export interface SpecCategoryDiff {
  category: SpecCategory;
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface SpecDiff {
  categories: SpecCategoryDiff[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  identical: boolean;
  changeRequests: string[];
  summary: string;
}

export interface SpecDiffAnalysis {
  meta: { projectName: string; generatedAt: string; generator: string };
  diff: SpecDiff;
  impact: ImpactAnalysis | null;
  plan: {
    filesToRegenerate: AffectedFile[];
    preservedFileCount: number;
    regenerateCount: number;
    fullRebuildRecommended: boolean;
  };
}

/* ── Deployment: one-click execution (Phase 13) ───────────────────────── */

export type DeployProviderId = 'vercel' | 'railway' | 'render';

export interface DeployProviderStatus {
  id: DeployProviderId;
  name: string;
  configured: boolean;
  requiredEnv: string[];
  docsUrl: string;
  strategy: string;
}

export type DeployExecutionPhase =
  'queued' | 'building' | 'deploying' | 'monitoring' | 'live' | 'failed';

export interface DeployExecution {
  id: string;
  provider: DeployProviderId;
  projectName: string;
  phase: DeployExecutionPhase;
  transitions: { phase: DeployExecutionPhase; at: string; detail: string }[];
  url: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecuteDeployRequest {
  provider: DeployProviderId;
  projectName: string;
  files: { path: string; content: string }[];
  env?: Record<string, string>;
}

export interface DeployExecutionPlan {
  provider: DeployProviderId;
  providerName: string;
  configured: boolean;
  requiredEnv: string[];
  strategy: string;
  steps: { name: string; description: string }[];
  artifactSummary: { fileCount: number; hasBackend: boolean; hasFrontend: boolean };
}

/* ── Local runner (Phase 13) ──────────────────────────────────────────── */

export type RunPhase =
  | 'preparing'
  | 'installing'
  | 'configuring'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'restarting'
  | 'failed';

export type RunProcessKind = 'backend' | 'frontend';

export interface RunProcess {
  kind: RunProcessKind;
  status: 'pending' | 'installing' | 'starting' | 'running' | 'exited';
  port: number | null;
  url: string | null;
  command: string;
  pid: number | null;
  exitCode: number | null;
}

export interface RunSession {
  id: string;
  projectName: string;
  phase: RunPhase;
  processes: RunProcess[];
  transitions: { phase: RunPhase; at: string; detail: string }[];
  workspaceDir: string;
  diagnostics: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRunSessionRequest {
  projectName: string;
  files: { path: string; content: string }[];
  env?: Record<string, string>;
}

export interface RunPlan {
  projectName: string;
  targets: {
    kind: RunProcessKind;
    directory: string;
    installCommand: string;
    startCommand: string;
    npmScript: string;
    envFile: { path: string; derivedFrom: string } | null;
  }[];
  steps: { name: string; description: string }[];
  warnings: string[];
}

export interface RunLogLine {
  seq: number;
  stream: RunProcessKind | 'system';
  line: string;
  at: string;
}

export interface RunLogChunk {
  lines: RunLogLine[];
  nextCursor: number;
}

/* ── Auth ─────────────────────────────────────────────────────────────── */

export type RoleName = 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  createdAt: string;
  onboardedAt: string | null;
}

/* ── End-to-end pipeline ──────────────────────────────────────────────── */

export type PipelineStageId =
  'analysis' | 'architecture' | 'database' | 'backend' | 'frontend' | 'security' | 'dependencies';

export type PipelineStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  status: PipelineStageStatus;
  engine: 'ai' | 'deterministic';
  /** The agent that will own this stage in v2. Declarative only. */
  agentId: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  degraded: boolean;
}

export interface PipelineAiUsage {
  calls: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface PipelineRun {
  id: string;
  /** The project this run belongs to. */
  projectId: string | null;
  projectName: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed';
  stages: PipelineStage[];
  ai: PipelineAiUsage;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface PipelineArtifacts {
  runId: string;
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  architectureMarkdown: string;
  design: DesignBundle;
  backend: GeneratedProject;
  frontend: GeneratedFrontend;
  security: SecurityBundle;
  dependencies: DependencyGraphBundle;
  files: { path: string; content: string }[];
}

/* ── Engineering Graph (Phase 3) ──────────────────────────────────────── */

export type EngNodeType =
  | 'PROJECT'
  | 'REQUIREMENT'
  | 'FEATURE'
  | 'COMPONENT'
  | 'SERVICE'
  | 'API'
  | 'ENTITY'
  | 'FIELD'
  | 'FILE'
  | 'MODULE'
  | 'SECURITY_RULE'
  | 'DEPENDENCY'
  | 'TEST';

export type EngRelationship =
  | 'CONTAINS'
  | 'IMPLEMENTS'
  | 'DEPENDS_ON'
  | 'USES'
  | 'CALLS'
  | 'EXPOSES'
  | 'PERSISTS'
  | 'BELONGS_TO'
  | 'GENERATES'
  | 'VALIDATES'
  | 'TESTS'
  | 'SECURED_BY';

export interface EngGraphNode {
  id: string;
  projectId: string;
  runId: string;
  type: EngNodeType;
  canonicalName: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  sourceArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngGraphEdge {
  id: string;
  projectId: string;
  runId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: EngRelationship;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EngGraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Partial<Record<EngNodeType, number>>;
  edgesByRelationship: Partial<Record<EngRelationship, number>>;
}

export interface EngineeringGraph {
  projectId: string;
  runId: string;
  nodes: EngGraphNode[];
  edges: EngGraphEdge[];
  stats: EngGraphStats;
  generatedAt: string;
}

export interface NodeNeighbourhood {
  node: EngGraphNode;
  outgoing: { edge: EngGraphEdge; node: EngGraphNode }[];
  incoming: { edge: EngGraphEdge; node: EngGraphNode }[];
}

export interface ImpactedNode {
  node: EngGraphNode;
  depth: number;
  via: EngRelationship;
  reason: string;
}

export interface GraphImpactAnalysis {
  origin: EngGraphNode;
  impacted: ImpactedNode[];
  summary: Partial<Record<EngNodeType, number>>;
  maxDepth: number;
}

export type EngGraphIssueKind =
  | 'orphan-node'
  | 'dangling-edge'
  | 'duplicate-edge'
  | 'invalid-relationship'
  | 'self-loop'
  | 'suspicious-cycle';

export interface EngGraphIssue {
  kind: EngGraphIssueKind;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeIds: string[];
}

export interface EngGraphValidationReport {
  valid: boolean;
  checkedNodes: number;
  checkedEdges: number;
  issues: EngGraphIssue[];
}

/* ── Agent orchestrator (Phase 6) ─────────────────────────────────────── */

export type AgentTaskStatus =
  'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';

export type AgentRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/* ── Project intelligence (Phase 12) ──────────────────────────────────── */

export type HealthState = 'HEALTHY' | 'WARNING' | 'FAILED' | 'NOT_RUN' | 'BLOCKED';

export interface HealthEntry {
  category: string;
  state: HealthState;
  detail: string;
}

export interface RunHistoryEntry {
  runId: string;
  createdAt: string;
  status: string;
  durationMs: number | null;
  agentsCompleted: number | null;
  agentsTotal: number | null;
  findings: number | null;
  reviewScore: number | null;
  gate: string | null;
  testsPassed: number | null;
  testsTotal: number | null;
  tokens: { input: number; output: number; costUsd: number } | null;
}

export interface ProjectIntelligenceView {
  status:
    | 'NOT_RUN'
    | 'BUILDING'
    | 'REVIEWING'
    | 'VALIDATING'
    | 'REPAIRING'
    | 'HEALTHY'
    | 'HEALTHY_WITH_WARNINGS'
    | 'REQUIRES_REVIEW'
    | 'FAILED';
  statusReason: string;
  health: HealthEntry[];
  metrics: {
    graphNodes: number | null;
    graphEdges: number | null;
    services: number;
    apis: number;
    entities: number;
    files: number;
    agentsExecuted: number;
    findings: number;
    testsTotal: number;
    testsPassed: number;
    repairsFixed: number;
  };
  graphPreview: {
    services: string[];
    entities: string[];
    apis: number;
    dependencies: string[];
  } | null;
  agents:
    | {
        agentId: string;
        name: string;
        status: string;
        durationMs: number | null;
        summary: string | null;
      }[]
    | null;
  timeline: { at: string; label: string; detail: string | null }[];
  findings: {
    total: number;
    open: number;
    fixed: number;
    requiresReview: number;
    bySeverity: Record<string, number>;
  } | null;
  validation: {
    gate: string;
    gateReason: string;
    rows: { name: string; status: CheckStatus; detail: string }[];
    tests: {
      total: number;
      passed: number;
      failed: number;
      blocked: number;
      skipped: number;
      failedCritical: number;
    };
  } | null;
  repairs: {
    finalState: string;
    stopReason: string;
    counts: RepairSessionView['counts'];
  } | null;
  tokens: {
    aiCalls: number;
    inputTokens: number;
    outputTokens: number;
    contextTokens: number;
    costUsd: number;
    byAgent: { agentId: string; name: string; tokens: number; costUsd: number }[];
    efficiency: {
      cacheHits: number;
      cacheMisses: number;
      tokensSaved: number;
      aiCallsSaved: number;
      cachedAgents: number;
    } | null;
  } | null;
  runs: RunHistoryEntry[];
}

/* ── Self-repair (Phase 11) ───────────────────────────────────────────── */

export interface RepairDiffHunk {
  line: number;
  removed: string[];
  added: string[];
}

export interface RepairFileChange {
  file: string;
  addedLines: number;
  removedLines: number;
  hunks: RepairDiffHunk[];
  previousVersion: number;
  newVersion: number;
}

export interface RepairAttemptView {
  attempt: number;
  strategy: string;
  applied: boolean;
  checks: { kind: string; status: 'PASS' | 'FAIL'; evidence: string }[];
  regressions: string[];
  outcome: 'ACCEPTED' | 'VALIDATION_FAILED' | 'REGRESSION' | 'PATCH_FAILED';
  error: string | null;
  durationMs: number;
}

export interface RepairRecordView {
  id: string;
  findingId: string;
  findingTitle: string;
  severity: string;
  eligibility: { eligibility: string; reason: string };
  rootCause: { rootCause: string; confidence: number; affectedFiles: string[] } | null;
  plan: {
    strategy: string;
    intent: string;
    authorizedFiles: string[];
    validation: string[];
    rollback: string;
  } | null;
  attempts: RepairAttemptView[];
  changeset: { files: RepairFileChange[]; rolledBack: boolean } | null;
  result: string;
  rolledBack: boolean;
  tokens: { input: number; output: number; context: number };
  durationMs: number;
  createdAt: string;
}

export interface RepairSessionView {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  finalState: string;
  stopReason: string;
  counts: {
    considered: number;
    autoRepairable: number;
    fixed: number;
    rejected: number;
    requiresReview: number;
    notRepairable: number;
    rolledBack: number;
    repairLoops: number;
  };
  tokens: { input: number; output: number; context: number };
  startedAt: string;
  completedAt: string | null;
  activeFindingId: string | null;
}

export interface RepairsView {
  session: RepairSessionView | null;
  repairs: RepairRecordView[];
}

/* ── Validation (Phase 10) ────────────────────────────────────────────── */

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED';
export type ValidationGate =
  'NOT_VALIDATED' | 'VALIDATING' | 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED' | 'BLOCKED';

export interface ValidationTestCase {
  id: string;
  name: string;
  type: 'UNIT' | 'INTEGRATION' | 'API' | 'E2E' | 'BUILD' | 'SMOKE';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  target: string;
  steps: { action: string; expect: string }[];
  expectedResult: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'BLOCKED';
  duration: number | null;
  error: string | null;
  evidence: string | null;
}

export interface ValidationSummaryView {
  runId: string;
  generatedAt: string;
  rows: { name: string; status: CheckStatus; detail: string }[];
  tests: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    failedCritical: number;
  };
  gate: ValidationGate;
  gateReason: string;
  agents: { agentId: string; status: 'COMPLETED' | 'FAILED'; durationMs: number | null }[];
}

export interface ValidationView {
  summary: ValidationSummaryView;
  runtime: {
    commands: {
      command: string;
      area: string;
      exitCode: number;
      durationMs: number;
      status: CheckStatus;
      outputTail: string;
    }[];
    processes: { kind: string; status: string; port: number | null; url: string | null }[];
    logSignals: { pattern: string; count: number; sample: string }[];
    errors: string[];
  } | null;
  integration: {
    checks: {
      kind: string;
      name: string;
      status: CheckStatus;
      evidence: string;
      error: string | null;
    }[];
    endpoints: { method: string; path: string; status: number | null; verdict: string }[];
  } | null;
  tests: { cases: ValidationTestCase[] } | null;
  versions: { version: number; createdAt: string }[];
}

/* ── Engineering review (Phase 9) ─────────────────────────────────────── */

export type FindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
export type FindingType = 'SECURITY' | 'DEPENDENCY' | 'CODE_QUALITY' | 'UX' | 'GENERAL';

export interface FindingRecord {
  id: string;
  projectId: string;
  runId: string;
  agentId: string;
  type: FindingType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  title: string;
  description: string;
  evidence: string | null;
  targetNodeId: string | null;
  targetFile: string | null;
  recommendation: string | null;
  confidence: number;
  status: FindingStatus;
  firstSeenReview: number;
  lastSeenReview: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSeverityCounts {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  INFO: number;
}

export interface ReviewSummary {
  reviewVersion: number;
  generatedAt: string;
  sections: {
    type: FindingType;
    total: number;
    counts: ReviewSeverityCounts;
    newSinceLastReview: number;
  }[];
  totals: { findings: number; counts: ReviewSeverityCounts; newSinceLastReview: number };
  score: {
    score: number;
    deductions: { severity: string; count: number; penaltyEach: number; total: number }[];
    totalDeducted: number;
    basis: string;
  };
  agents: {
    agentId: string;
    status: 'COMPLETED' | 'FAILED';
    findings: number;
    error: string | null;
  }[];
  status: 'COMPLETE' | 'PARTIAL_REVIEW' | 'FAILED';
  notes: string[];
}

export interface EngineeringReview {
  reviewVersion: number;
  projectId: string;
  runId: string;
  generatedAt: string;
  summary: ReviewSummary;
  findings: FindingRecord[];
  usage: { agentId: string; durationMs: number | null; usage: AgentTask['usage'] }[];
}

export interface EngineeringReviewEnvelope {
  current: EngineeringReview;
  versions: { version: number; createdAt: string }[];
}

export interface AgentFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  title: string;
  description: string;
  targetNodeId: string | null;
  status: 'OPEN' | 'RESOLVED';
}

export interface AgentTask {
  id: string;
  projectId: string;
  runId: string;
  agentId: string;
  status: AgentTaskStatus;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  inputArtifactTypes: string[];
  dependencyTaskIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  failureKind: string | null;
  retryCount: number;
  summary: string | null;
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    contextTokens: number;
  } | null;
  findings: AgentFinding[];
}

export interface AgentRun {
  id: string;
  projectId: string;
  ownerId: string;
  prompt: string;
  status: AgentRunStatus;
  tasks: AgentTask[];
  currentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  totals: {
    aiCalls: number;
    inputTokens: number;
    outputTokens: number;
    contextTokens: number;
    costUsd: number;
  };
}

export interface AgentRunProgress {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  running: number;
  pending: number;
}

export interface AgentRunView {
  run: AgentRun;
  progress: AgentRunProgress;
}

export interface AgentCatalogueEntry {
  id: string;
  name: string;
  role: string;
  version: string;
  executionMode: string;
  enabled: boolean;
  implemented: boolean;
  requires: string[];
  produces: string[];
  dependencies: string[];
}
