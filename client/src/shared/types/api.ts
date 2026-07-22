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
  favorite: boolean;
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
