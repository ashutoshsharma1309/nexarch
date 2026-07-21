/**
 * Turns the raw graph-optimizer findings (cycles, unreferenced files,
 * duplicates) plus two additional checks — dead routes and a layering
 * violation (a controller reaching straight into a repository, skipping
 * the service) — into the quality report and its recommendations.
 */
import type {
  BackendBundle,
  FrontendBundle,
  GraphEdge,
  GraphNode,
  QualityReport,
} from '../dependency-graph.types.js';
import {
  buildAdjacency,
  detectCycles,
  findDuplicateContent,
  findOrphanNodes,
  findUnreferencedNodes,
  structuralEdges,
} from './graph-optimizer.js';
import type { ScannedFile } from './project-scanner.js';

function findLayeringViolations(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const violations: QualityReport['architectureViolations'] = [];
  const skippingService = edges.filter((edge) => {
    if (edge.type !== 'imports') return false;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return from?.type === 'controller' && to?.type === 'repository';
  });
  if (skippingService.length > 0) {
    violations.push({
      severity: 'medium',
      rule: 'controller-bypasses-service',
      description:
        'A controller imports a repository directly, bypassing the service layer that should own business logic.',
      nodeIds: skippingService.flatMap((e) => [e.from, e.to]),
    });
  }
  return violations;
}

function findDeadRoutes(backend: BackendBundle, frontend: FrontendBundle): string[] {
  const backendDead = backend.routes
    .filter((r) => !r.implemented)
    .map((r) => `${r.method} ${r.path}`);
  const pendingPages = new Set(frontend.pages.filter((p) => !p.implemented).map((p) => p.name));
  const frontendDead = frontend.routes.filter((r) => pendingPages.has(r.page)).map((r) => r.path);
  return [...new Set([...backendDead, ...frontendDead])];
}

function buildRecommendations(report: Omit<QualityReport, 'recommendations'>): string[] {
  const recommendations: string[] = [];

  if (report.circularDependencies.length > 0) {
    recommendations.push(
      `${report.circularDependencies.length} circular dependenc${report.circularDependencies.length === 1 ? 'y' : 'ies'} detected — break the cycle by extracting the shared piece into its own module.`,
    );
  }
  if (report.unusedComponents.length > 0) {
    recommendations.push(
      `${report.unusedComponents.length} file${report.unusedComponents.length === 1 ? '' : 's'} are never imported by anything else — safe to remove if they aren't an intentional public entry point.`,
    );
  }
  if (report.deadRoutes.length > 0) {
    recommendations.push(
      `${report.deadRoutes.length} route${report.deadRoutes.length === 1 ? '' : 's'} point at unimplemented modules — either implement the backing module or remove the route.`,
    );
  }
  if (report.duplicateGroups.length > 0) {
    recommendations.push(
      `${report.duplicateGroups.length} group${report.duplicateGroups.length === 1 ? '' : 's'} of files are byte-identical — consolidate into one shared file.`,
    );
  }
  if (report.architectureViolations.length > 0) {
    recommendations.push(
      `${report.architectureViolations.length} architecture violation${report.architectureViolations.length === 1 ? '' : 's'} found — see the layering rule details.`,
    );
  }
  if (report.orphanFiles.length > 0) {
    recommendations.push(
      `${report.orphanFiles.length} file${report.orphanFiles.length === 1 ? '' : 's'} are fully disconnected from the rest of the project graph.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'No quality issues detected — the graph is fully connected with no cycles or duplicates.',
    );
  }

  return recommendations;
}

export function analyzeQuality(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  files: readonly ScannedFile[],
  backend: BackendBundle,
  frontend: FrontendBundle,
): QualityReport {
  const adjacency = buildAdjacency(nodes, structuralEdges(edges));
  const circularDependencies = detectCycles(nodes, adjacency);
  const orphanFiles = findOrphanNodes(nodes, adjacency);
  const unusedComponents = findUnreferencedNodes(nodes, adjacency).filter((id) => {
    const node = nodes.find((n) => n.id === id);
    return node?.type === 'component' || node?.type === 'utility';
  });
  const deadRoutes = findDeadRoutes(backend, frontend);
  const duplicateGroups = findDuplicateContent(files);
  const architectureViolations = findLayeringViolations(nodes, edges);

  const withoutRecommendations = {
    circularDependencies,
    orphanFiles,
    unusedComponents,
    deadRoutes,
    duplicateGroups,
    architectureViolations,
  };

  return {
    ...withoutRecommendations,
    recommendations: buildRecommendations(withoutRecommendations),
  };
}
