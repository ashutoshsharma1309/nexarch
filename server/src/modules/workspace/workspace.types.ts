/**
 * Workspace domain types (Phase 10).
 *
 * `Project` mirrors `prisma/schema.prisma`'s `Project` model field-for-field
 * (plus `favorite`, which the schema doesn't have yet) so the in-memory
 * store below can be swapped for a real Prisma-backed one with no shape
 * change once auth ships a real `ownerId`. Same for `GenerationRecord`
 * against the `Generation` model — extended with the operational fields
 * (model/tokens/cost/duration) the Generation History UI needs, which a
 * migration can add as real columns later.
 *
 * `ProjectArtifacts` is the one new cross-stage contract this phase
 * introduces: documentation and exports are pure functions of whatever
 * pipeline data the client already holds (requirements, architecture,
 * database design, generated bundles, security report, dependency graph).
 * The workspace module never reads another module's in-memory cache —
 * "modules are islands" — so the client sends the artifacts it already has
 * in its React Query cache, the same way `dependency-graph/build` takes the
 * full upstream bundle as its request body instead of reaching across
 * modules for it.
 */
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DatabaseDesign, OpenApiDocument } from '../../shared/types/design.js';
import type { Project, ProjectStatus } from '../../shared/contracts/project.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

/* ── Projects ─────────────────────────────────────────────────────────── */

export type { ProjectStatus } from '../../shared/contracts/project.js';

/**
 * Re-exported from the v2 contracts so there is exactly one `Project` shape
 * in the codebase. Workspace owns project *behaviour* (activity logging,
 * documentation, export); it does not get its own definition of what a
 * project is.
 */
export type { Project } from '../../shared/contracts/project.js';

export interface CreateProjectInput {
  name: string;
  description?: string | null | undefined;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  favorite?: boolean;
}

export interface ListProjectsQuery {
  search?: string | undefined;
  status?: ProjectStatus | undefined;
  favorite?: boolean | undefined;
}

/* ── Generation history (project-level runs, distinct from the AI
   Orchestrator's per-call history at `/ai/history`) ─────────────────── */

export type GenerationStatus =
  'PENDING' | 'ANALYZING' | 'PLANNING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';

export interface GenerationRecord {
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

export interface CreateGenerationInput {
  projectId: string;
  prompt: string;
  status?: GenerationStatus | undefined;
  model?: string | undefined;
  tokensUsed?: number | undefined;
  costUsd?: number | undefined;
  durationMs?: number | undefined;
  filesGenerated?: number | undefined;
  filesModified?: number | undefined;
  error?: string | undefined;
}

/* ── Workspace activity log — project/workspace level events (created,
   renamed, exported...), distinct from AI call-level history ────────── */

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
  | 'documentation.generated'
  | 'project.imported'
  | 'demo.reset';

export interface ActivityLogEntry {
  id: string;
  type: ActivityEventType;
  projectId: string | null;
  projectName: string | null;
  message: string;
  createdAt: string;
}

/* ── Pipeline artifacts bag — everything documentation/export can draw on,
   all optional since a project may be at any pipeline stage ───────────── */

export interface SecurityArtifact {
  report: {
    overallScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    summary: { critical: number; high: number; medium: number; low: number; resolved: number };
    recommendations: string[];
  };
  owasp: { passed: number; warned: number; failed: number; notApplicable: number };
  stats: { backendFiles: number; frontendFiles: number; findings: number; resolved: number };
}

export interface DependencyGraphArtifact {
  stats: {
    totalNodes: number;
    totalEdges: number;
    averageDependencyDepth: number;
    circularDependencyCount: number;
    orphanFileCount: number;
  };
  quality: { recommendations: string[] };
}

export interface BackendArtifact {
  files: { path: string; content?: string }[];
  modules: string[];
  routes: { method: string; path: string }[];
}

export interface FrontendArtifact {
  files: { path: string; content?: string }[];
  pages: { name: string; route: string }[];
  components: string[];
}

export interface ProjectArtifacts {
  projectName: string;
  requirements?: RequirementSpec;
  architecture?: ArchitecturePlan;
  databaseDesign?: DatabaseDesign;
  prismaSchema?: string;
  sqlSchema?: string;
  openapi?: OpenApiDocument;
  backend?: BackendArtifact;
  frontend?: FrontendArtifact;
  security?: SecurityArtifact;
  dependencyGraph?: DependencyGraphArtifact;
}

/* ── Documentation ────────────────────────────────────────────────────── */

export type DocumentationType =
  | 'readme'
  | 'api'
  | 'architecture'
  | 'database'
  | 'security'
  | 'deployment-guide'
  | 'developer-guide';

export interface DocumentationRequest {
  type: DocumentationType;
  artifacts: ProjectArtifacts;
}

export interface DocumentationResult {
  type: DocumentationType;
  filename: string;
  markdown: string;
}

/* ── Export engine ───────────────────────────────────────────────────── */

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

export interface ExportRequest {
  format: ExportFormat;
  artifacts: ProjectArtifacts;
  projectId?: string | undefined;
}

export interface ExportFile {
  path: string;
  content: string;
}

export type ExportResult =
  | { kind: 'file'; filename: string; mimeType: string; content: string }
  | { kind: 'archive'; files: ExportFile[] };

/* ── Dashboard ────────────────────────────────────────────────────────── */

export interface ProjectDashboard {
  project: Project;
  generations: GenerationRecord[];
  latestGeneration: GenerationRecord | null;
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
