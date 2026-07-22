/**
 * Quality domain types (Phase 12).
 *
 * `QualityArtifacts` is a local, duck-typed superset of Phase 10's
 * `ProjectArtifacts` shape (backend/frontend files, architecture, database
 * design, security, dependency graph) plus the AI Orchestrator's
 * aggregate stats — "modules are islands" means this module can't import
 * workspace's or ai-orchestrator's internals, so it re-declares only the
 * slice of each shape it actually reads. The client sends the same
 * `ProjectArtifacts` object it already assembles for Documentation/Export/
 * Deployment, plus optional AI stats fetched from the orchestrator's own
 * endpoints.
 */

/* ── Inputs ───────────────────────────────────────────────────────────── */

export interface QualityFile {
  path: string;
  content?: string;
}

export interface QualityArtifacts {
  projectName: string;
  requirements?: {
    frontend?: string[];
    backend?: string[];
    modules?: string[];
    authentication?: string[];
  };
  architecture?: {
    decisions?: { architecture?: { choice?: string } };
    folderStructure?: { name: string; type: 'directory' | 'file'; children?: unknown[] }[];
    database?: { engine?: string };
  };
  databaseDesign?: { tables?: { entity: string }[] };
  backend?: { files: QualityFile[]; modules: string[]; routes: { method: string; path: string }[] };
  frontend?: {
    files: QualityFile[];
    pages: { name: string; route: string }[];
    components: string[];
  };
  openapi?: { paths?: Record<string, unknown> };
  security?: {
    report: {
      overallScore: number;
      grade: 'A' | 'B' | 'C' | 'D' | 'F';
      summary: { critical: number; high: number; medium: number; low: number; resolved: number };
      recommendations: string[];
    };
    owasp: { passed: number; warned: number; failed: number; notApplicable: number };
    stats: { backendFiles: number; frontendFiles: number; findings: number; resolved: number };
  };
  dependencyGraph?: {
    stats: {
      totalNodes: number;
      totalEdges: number;
      averageDependencyDepth: number;
      circularDependencyCount: number;
      orphanFileCount: number;
    };
    quality: {
      recommendations: string[];
      orphanFiles?: string[];
      unusedComponents?: string[];
      deadRoutes?: string[];
    };
  };
  aiStats?: {
    totalGenerations: number;
    totalTokens: number;
    totalCostUsd: number;
    averageDurationMs: number;
    cache: { hitRate: number };
  };
  deploymentConfigured?: boolean;
}

/* ── Testing ──────────────────────────────────────────────────────────── */

export type TestFileLanguage = 'typescript' | 'json' | 'markdown';

export interface TestFile {
  path: string;
  content: string;
  language: TestFileLanguage;
  kind: 'unit' | 'integration' | 'api' | 'component' | 'e2e' | 'regression' | 'smoke';
}

export interface OpenApiValidationResult {
  valid: boolean;
  issues: string[];
  endpointsCovered: number;
}

export interface TestingReport {
  files: TestFile[];
  summary: { kind: TestFile['kind']; fileCount: number; caseCount: number }[];
  coverageEstimatePercent: number;
  openApiValidation: OpenApiValidationResult;
}

/* ── Quality analysis ─────────────────────────────────────────────────── */

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

export interface LargeFile {
  path: string;
  lines: number;
}

export interface QualityReport {
  metrics: QualityMetric[];
  issues: QualityIssue[];
  duplication: { duplicateGroups: number; affectedFiles: number };
  complexity: { averageScore: number; highestFile: string | null; highestScore: number };
  deadCode: { unusedComponents: string[]; deadRoutes: string[]; orphanFiles: string[] };
  circularDependencies: number;
  largeFiles: LargeFile[];
  score: number;
}

/* ── Performance ──────────────────────────────────────────────────────── */

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

/* ── Security validation ──────────────────────────────────────────────── */

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

/* ── Architecture validation ─────────────────────────────────────────── */

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

/* ── Documentation ────────────────────────────────────────────────────── */

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

export interface DocumentationFile {
  kind: DocumentationFileKind;
  filename: string;
  content: string;
}

export interface DocumentationBundle {
  files: DocumentationFile[];
}

/* ── Engineering score ────────────────────────────────────────────────── */

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

/* ── Benchmark ────────────────────────────────────────────────────────── */

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

/* ── Release readiness ────────────────────────────────────────────────── */

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

/* ── The full analysis bundle (cached by GET endpoints) ─────────────────── */

export interface EngineeringBundle {
  meta: { projectName: string; generatedAt: string; generator: string };
  quality: QualityReport;
  performance: PerformanceReport;
  security: SecurityValidationReport;
  architecture: ArchitectureValidationReport;
  testingSummary: TestingReport['summary'];
  testingCoverageEstimatePercent: number;
  score: EngineeringScore;
  benchmark: BenchmarkReport;
  readiness: ReleaseReadiness;
}

export interface AnalyzeRequest {
  artifacts: QualityArtifacts;
}

/* ── Export engine ────────────────────────────────────────────────────── */

export type ExportFormat =
  | 'quality-report'
  | 'testing-report'
  | 'benchmark-report'
  | 'engineering-score'
  | 'release-readiness'
  | 'readme'
  | 'documentation-package';

export interface ExportRequest {
  format: ExportFormat;
  artifacts: QualityArtifacts;
}

export interface ExportFileEntry {
  path: string;
  content: string;
}

export type ExportResult =
  | { kind: 'file'; filename: string; mimeType: string; content: string }
  | { kind: 'archive'; files: ExportFileEntry[] };
