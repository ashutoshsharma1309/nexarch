/**
 * Contracts for the Dependency Graph & Incremental Regeneration Engine
 * (Phase 8). This module generates nothing — it scans what Phases 5-7
 * already produced, builds a directed graph of how it fits together, and
 * uses that graph to answer two questions cheaply: "what does this change
 * touch?" and "what's safe to leave alone?". Nothing here is written to the
 * platform's own source tree.
 */
import type { FolderNode } from '../../shared/types/architecture.js';
import type { SpecDiff } from './lib/spec-differ.js';

/* ── Duck-typed inputs — the real Phase 5/6/7 outputs satisfy these
   structurally, the same convention every generator module already uses. */

export type FileLanguage = string;

export interface ProjectFile {
  path: string;
  content: string;
  language: FileLanguage;
}

export interface BackendBundle {
  files: ProjectFile[];
  modules: { name: string; entity: string | null; crud: boolean; endpoints: number }[];
  routes: { method: string; path: string; auth: boolean; implemented: boolean }[];
}

export interface FrontendBundle {
  files: ProjectFile[];
  pages: {
    name: string;
    route: string;
    kind: string;
    entity: string | null;
    implemented: boolean;
  }[];
  components: { name: string; kind: string; file: string }[];
  routes: { path: string; page: string; protected: boolean; lazy: boolean }[];
  stores: { name: string; file: string; persisted: boolean }[];
}

export interface SecurityBundleInput {
  backendFiles: ProjectFile[];
  frontendFiles: ProjectFile[];
  rbac: {
    roles: { role: string; description: string }[];
    permissions: { entity: string; role: string; actions: string[] }[];
  };
}

/* ── Graph model ──────────────────────────────────────────────────────── */

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
  /** Free-form facts a consumer may want (e.g. httpMethod, entity, role list) — never load-bearing for graph algorithms. */
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
    /** Which input bundles contributed nodes, e.g. ['backend', 'frontend', 'security', 'database']. */
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

/* ── Layout (visualization) ──────────────────────────────────────────── */

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

/* ── Quality analysis ─────────────────────────────────────────────────── */

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

/* ── Statistics ───────────────────────────────────────────────────────── */

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

/* ── Change detection + impact analysis ─────────────────────────────────── */

export interface ChangeClassification {
  category: string;
  keywords: string[];
  /** 0-1 — fraction of the request's significant tokens that matched a known signal or a graph node label. */
  confidence: number;
  seedNodeIds: string[];
}

export interface AffectedFile {
  path: string;
  group: ModuleGroup;
  reason: string;
  nodeId: string;
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

/* ── Token optimizer ──────────────────────────────────────────────────── */

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

/* ── Merge engine + versioning ────────────────────────────────────────── */

export type FileProvenance = 'regenerated' | 'preserved' | 'manual';

export interface MergedFile {
  path: string;
  content: string;
  language: FileLanguage;
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
  folderTree: FolderNode[];
}

/* ── The full /build response ─────────────────────────────────────────── */

export interface DependencyGraphBundle {
  meta: DependencyGraph['meta'];
  graph: DependencyGraph;
  layout: GraphLayout;
  stats: DependencyStats;
  quality: QualityReport;
}

/* ── Prompt-diff regeneration (Phase 13) ─────────────────────────────── */

export type { SpecCategory, SpecCategoryDiff, SpecDiff } from './lib/spec-differ.js';

/**
 * What `POST /dependency/diff` returns: the requirement-level diff between
 * the spec the project was built from and the newly analyzed spec, the
 * impact of that diff on the existing graph, and the resulting selective
 * regeneration plan. `impact` is null when the specs are identical — there
 * is nothing to analyze, and saying so beats a degenerate empty analysis.
 */
export interface SpecDiffAnalysis {
  meta: { projectName: string; generatedAt: string; generator: string };
  diff: SpecDiff;
  impact: ImpactAnalysis | null;
  plan: {
    filesToRegenerate: AffectedFile[];
    preservedFileCount: number;
    regenerateCount: number;
    /** Regenerate everything when the diff is too broad for selective merge to pay off. */
    fullRebuildRecommended: boolean;
  };
}
