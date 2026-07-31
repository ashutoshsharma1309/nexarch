/**
 * Deployment domain types (Phase 11).
 *
 * Phases 5/6 already emit a working multi-stage `Dockerfile` inside each
 * generated project (`backend-generator/lib/emit-project-files.ts`,
 * `frontend-generator/lib/emit-project-files.ts`) — this module never
 * re-generates those. It generates what's still missing for a project to be
 * deployable: compose files that wire the two existing Dockerfiles
 * together, `.dockerignore`, CI/CD workflows, environment templates,
 * health/monitoring/logging route code the generators don't emit, backup
 * and scalability documentation, and per-target deployment configuration.
 *
 * `DeploymentArtifacts` is a local, duck-typed read of the same pipeline
 * data Phase 10's `ProjectArtifacts` carries — "modules are islands" means
 * this module can't import workspace's internals, so it re-declares only
 * the slice of that shape it actually reads (projectName, database engine,
 * backend/frontend file lists). The client sends its existing
 * `ProjectArtifacts` object as-is; extra fields are simply ignored here.
 */

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

/* ── Inputs ───────────────────────────────────────────────────────────── */

export interface DeploymentArtifacts {
  projectName: string;
  architecture?: { database?: { engine?: string } };
  requirements?: { frontend?: string[]; backend?: string[] };
  backend?: { files: { path: string; content?: string }[] };
  frontend?: { files: { path: string; content?: string }[] };
}

export interface GenerateDeploymentRequest {
  target: DeploymentTarget;
  artifacts: DeploymentArtifacts;
}

/* ── Docker ───────────────────────────────────────────────────────────── */

export interface DockerBundle {
  dockerignoreBackend: DeploymentFile;
  dockerignoreFrontend: DeploymentFile;
  composeDev: DeploymentFile;
  composeProd: DeploymentFile;
}

/* ── Environment ──────────────────────────────────────────────────────── */

export interface EnvVarRule {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
  example: string;
}

export interface EnvironmentBundle {
  envExample: DeploymentFile;
  envDevelopment: DeploymentFile;
  envProduction: DeploymentFile;
  validationRules: EnvVarRule[];
  docs: DeploymentFile;
}

/* ── CI/CD ────────────────────────────────────────────────────────────── */

export interface CiCdBundle {
  buildWorkflow: DeploymentFile;
  deployWorkflow: DeploymentFile;
}

/* ── Health / Monitoring / Logging ───────────────────────────────────── */

export interface HealthBundle {
  files: DeploymentFile[];
}

export interface MonitoringBundle {
  files: DeploymentFile[];
}

export interface LoggingBundle {
  files: DeploymentFile[];
}

/* ── Docs ─────────────────────────────────────────────────────────────── */

export interface BackupDocs {
  markdown: string;
}

export interface ScalabilityDocs {
  markdown: string;
}

export interface DeploymentGuide {
  markdown: string;
}

/* ── Target-specific configuration ───────────────────────────────────── */

export interface TargetConfig {
  files: DeploymentFile[];
}

/* ── The full bundle ──────────────────────────────────────────────────── */

export interface DeploymentBundle {
  target: DeploymentTarget;
  meta: { projectName: string; generatedAt: string; generator: string };
  docker: DockerBundle;
  environment: EnvironmentBundle;
  cicd: CiCdBundle;
  health: HealthBundle;
  monitoring: MonitoringBundle;
  logging: LoggingBundle;
  backup: BackupDocs;
  scalability: ScalabilityDocs;
  targetConfig: TargetConfig;
  guide: DeploymentGuide;
}

/* ── Export engine ────────────────────────────────────────────────────── */

export type ExportFormat =
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

export interface ExportRequest {
  format: ExportFormat;
  target: DeploymentTarget;
  artifacts: DeploymentArtifacts;
}

export interface ExportFileEntry {
  path: string;
  content: string;
}

export type ExportResult =
  | { kind: 'file'; filename: string; mimeType: string; content: string }
  | { kind: 'archive'; files: ExportFileEntry[] };

/* ── Status / health preview ──────────────────────────────────────────── */

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

/* ── One-click deploy execution (Phase 13) ────────────────────────────── */

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

export interface DeployTransition {
  phase: DeployExecutionPhase;
  at: string;
  detail: string;
}

export interface DeployExecution {
  id: string;
  provider: DeployProviderId;
  projectName: string;
  phase: DeployExecutionPhase;
  transitions: DeployTransition[];
  url: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecuteDeployRequest {
  provider: DeployProviderId;
  projectName: string;
  files: { path: string; content: string }[];
  /** Environment for the deployed app — forwarded to the provider, never logged. */
  env?: Record<string, string> | undefined;
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
