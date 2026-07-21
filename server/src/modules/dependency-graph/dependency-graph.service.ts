/**
 * Orchestrates the Dependency Graph Engine. Every function here is a pure
 * function of its full input, same discipline as every other generator
 * module — `build`/`analyze`/`regenerate` never depend on hidden
 * server-side state; only the two GET endpoints (which can't carry a body)
 * read from the controller's cache of the last build.
 */
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import { analyzeQuality } from './lib/quality-analyzer.js';
import { buildFolderTree } from './lib/file-tree.js';
import { buildGraphElements } from './lib/graph-builder.js';
import {
  buildDependencyGraph,
  buildDependencyStats,
  buildGraphLayout,
} from './lib/graph-serializer.js';
import { analyzeImpact } from './lib/impact-analyzer.js';
import { mergeProject } from './lib/merge-engine.js';
import { scanProject } from './lib/project-scanner.js';
import type { ScannedProject } from './lib/project-scanner.js';
import { recordVersion } from './lib/version-manager.js';
import type {
  BackendBundle,
  DependencyGraphBundle,
  FrontendBundle,
  ImpactAnalysis,
  ProjectFile,
  RegenerationResult,
  SecurityBundleInput,
} from './dependency-graph.types.js';

export interface GraphInputs {
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  database: DatabaseDesign;
  backend: BackendBundle;
  frontend: FrontendBundle;
  security: SecurityBundleInput;
}

export interface BuildResult {
  bundle: DependencyGraphBundle;
  project: ScannedProject;
}

export function buildDependencyGraphBundle(inputs: GraphInputs): BuildResult {
  const project = scanProject(inputs.backend, inputs.frontend, inputs.security);
  const { nodes, edges } = buildGraphElements(
    project,
    inputs.backend,
    inputs.frontend,
    inputs.database,
  );

  const graph = buildDependencyGraph(
    inputs.architecture.meta.projectName,
    inputs.architecture.meta.projectType,
    nodes,
    edges,
    ['requirements', 'architecture', 'database', 'backend', 'frontend', 'security'],
  );
  const layout = buildGraphLayout(nodes, edges);
  const stats = buildDependencyStats(nodes, edges);
  const quality = analyzeQuality(nodes, edges, project.files, inputs.backend, inputs.frontend);

  return { bundle: { meta: graph.meta, graph, layout, stats, quality }, project };
}

export function analyzeChangeImpact(changeRequest: string, inputs: GraphInputs): ImpactAnalysis {
  const { bundle, project } = buildDependencyGraphBundle(inputs);
  return analyzeImpact(changeRequest, bundle.graph, project);
}

export interface RegenerateInputs extends GraphInputs {
  changeRequest: string;
  newBackend: BackendBundle;
  newFrontend: FrontendBundle;
  newSecurity: SecurityBundleInput;
  manualEdits?: Record<string, string> | undefined;
}

function toProjectFiles(project: ScannedProject): ProjectFile[] {
  return project.files.map((f) => ({ path: f.path, content: f.content, language: f.language }));
}

export function regenerateProject(inputs: RegenerateInputs): RegenerationResult {
  const { bundle, project } = buildDependencyGraphBundle(inputs);
  const impact = analyzeImpact(inputs.changeRequest, bundle.graph, project);
  const affectedPaths = new Set(impact.affectedFiles.map((f) => f.path));

  const newProject = scanProject(inputs.newBackend, inputs.newFrontend, inputs.newSecurity);

  const { files, stats } = mergeProject({
    oldFiles: toProjectFiles(project),
    newFiles: toProjectFiles(newProject),
    affectedPaths,
    manualEdits: inputs.manualEdits,
  });

  const manifest = recordVersion(
    inputs.architecture.meta.projectName,
    inputs.changeRequest,
    files.filter((f) => f.provenance === 'regenerated').map((f) => f.path),
    files.filter((f) => f.provenance === 'preserved').map((f) => f.path),
    files.filter((f) => f.provenance === 'manual').map((f) => f.path),
  );

  return {
    meta: {
      projectName: inputs.architecture.meta.projectName,
      generatedAt: new Date().toISOString(),
      generator: 'NexArch Dependency Graph Engine',
    },
    files,
    stats,
    manifest,
    folderTree: buildFolderTree(files),
  };
}
