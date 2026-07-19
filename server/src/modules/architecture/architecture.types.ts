/**
 * The Software Design Specification (SDS) produced by the Architecture
 * Planner. This is the contract every downstream stage consumes: the
 * Database Designer reads `database`, the generators read `folderStructure`,
 * `apiModules`, `frontend` and `services`, the Security Engine reads
 * `security`, and incremental regeneration reads `dependencyGraph`.
 *
 * Every decision carries its reasoning and the alternatives that were
 * rejected — an architecture plan without a "why" is a folder listing.
 */

export interface ArchitectureDecision {
  choice: string;
  reasoning: string;
  alternatives: { option: string; rejectedBecause: string }[];
}

export interface ArchitectureDecisions {
  architecture: ArchitectureDecision;
  frontendArchitecture: ArchitectureDecision;
  backendArchitecture: ArchitectureDecision;
  database: ArchitectureDecision;
  authentication: ArchitectureDecision;
}

/* ── Folder structure ────────────────────────────────────────────────── */

export interface FolderNode {
  name: string;
  type: 'directory' | 'file';
  children?: FolderNode[];
}

/* ── API plan ────────────────────────────────────────────────────────── */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  description: string;
  /** Requires an authenticated user. */
  auth: boolean;
  /** Restricted to these roles when present (subset of spec.roles + Admin). */
  roles?: string[];
}

export interface ApiModulePlan {
  module: string;
  basePath: string;
  endpoints: ApiEndpoint[];
}

/* ── Database plan ───────────────────────────────────────────────────── */

export interface EntityRelation {
  type: 'many-to-one' | 'one-to-one';
  target: string;
  foreignKey: string;
}

export interface EntityPlan {
  name: string;
  tableName: string;
  primaryKey: string;
  /** Representative columns; full column design is the Database Designer's job. */
  keyFields: string[];
  relations: EntityRelation[];
  indexes: string[];
}

export interface DatabasePlan {
  engine: string;
  entities: EntityPlan[];
  normalization: string[];
}

/* ── Frontend plan ───────────────────────────────────────────────────── */

export interface PagePlan {
  name: string;
  route: string;
  layout: 'AuthLayout' | 'AppLayout';
  access: string[];
}

export interface FrontendPlan {
  pages: PagePlan[];
  layouts: string[];
  navigation: { label: string; route: string; roles: string[] }[];
  dashboardWidgets: { name: string; description: string }[];
  reusableComponents: string[];
}

/* ── Backend plan ────────────────────────────────────────────────────── */

export interface BackendModulePlan {
  module: string;
  controller: string;
  service: string;
  repository: string;
  dtos: string[];
  validators: string[];
}

export interface MiddlewarePlan {
  name: string;
  purpose: string;
}

/* ── Security plan ───────────────────────────────────────────────────── */

export interface SecurityPlan {
  authentication: string[];
  sessionStrategy: string;
  authorization: string;
  passwordPolicy: string[];
  rateLimiting: string[];
  validation: string;
  headers: string[];
  cors: string;
}

/* ── Dependency graph ────────────────────────────────────────────────── */

export interface DependencyGraph {
  nodes: { id: string; label: string }[];
  /** `from` depends on `to`. */
  edges: { from: string; to: string; reason: string }[];
}

/* ── Scalability & NFR ───────────────────────────────────────────────── */

export interface ScalabilityRecommendation {
  concern: string;
  recommendation: string;
  /** When this investment actually becomes necessary. */
  trigger: string;
}

export interface NfrScore {
  /** 1–10 for the architecture as planned. */
  score: number;
  notes: string;
}

export interface NonFunctionalReport {
  performance: NfrScore;
  maintainability: NfrScore;
  security: NfrScore;
  scalability: NfrScore;
  availability: NfrScore;
  reliability: NfrScore;
}

/* ── The assembled plan ──────────────────────────────────────────────── */

export interface ArchitecturePlan {
  meta: {
    projectName: string;
    projectType: string;
    generatedAt: string;
    planner: string;
  };
  decisions: ArchitectureDecisions;
  folderStructure: FolderNode[];
  apiModules: ApiModulePlan[];
  frontend: FrontendPlan;
  database: DatabasePlan;
  services: BackendModulePlan[];
  middleware: MiddlewarePlan[];
  security: SecurityPlan;
  dependencyGraph: DependencyGraph;
  futureScalability: ScalabilityRecommendation[];
  nonFunctional: NonFunctionalReport;
}

/** API response: the plan plus its Markdown rendering for export. */
export interface ArchitectureResponse {
  plan: ArchitecturePlan;
  markdown: string;
}
