/**
 * Expands a change request's seed nodes (from `change-detector.ts`) into
 * the full affected set: every seed's forward-transitive closure (what you
 * need to touch to actually implement the change — a changed service pulls
 * in its repository, model, and table) unioned with each seed's direct
 * callers (what might break — the controller that invokes it). This is
 * deliberately asymmetric: full closure downstream, one hop upstream —
 * otherwise a single seed on a widely-imported utility would pull in the
 * entire graph as "affected", defeating the point of impact analysis.
 */
import type {
  AffectedFile,
  DependencyGraph,
  GraphNode,
  ImpactAnalysis,
} from '../dependency-graph.types.js';
import { detectChange } from './change-detector.js';
import { buildAdjacency } from './graph-optimizer.js';
import type { ScannedProject } from './project-scanner.js';
import { computeTokenOptimization } from './token-optimizer.js';

function forwardClosure(
  seedIds: readonly string[],
  outgoing: Map<string, string[]>,
  maxDepth = 8,
): Set<string> {
  const visited = new Set(seedIds);
  let frontier = [...seedIds];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const target of outgoing.get(id) ?? []) {
        if (!visited.has(target)) {
          visited.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  return visited;
}

function oneHopReverse(seedIds: readonly string[], incoming: Map<string, string[]>): Set<string> {
  const result = new Set(seedIds);
  for (const id of seedIds) {
    for (const source of incoming.get(id) ?? []) result.add(source);
  }
  return result;
}

function reasonFor(node: GraphNode, seedIds: ReadonlySet<string>): string {
  if (seedIds.has(node.id)) return 'Directly matches the change request.';
  return 'Depends on, or is depended on by, a directly affected node.';
}

const CONFIG_TYPES = new Set(['config', 'env-var']);

export function analyzeImpact(
  changeRequest: string,
  graph: DependencyGraph,
  project: ScannedProject,
): ImpactAnalysis {
  const classification = detectChange(changeRequest, graph.nodes);
  const adjacency = buildAdjacency(graph.nodes, graph.edges);

  const downstream = forwardClosure(classification.seedNodeIds, adjacency.outgoing);
  const upstream = oneHopReverse(classification.seedNodeIds, adjacency.incoming);
  const affectedIds = new Set([...downstream, ...upstream]);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const affectedFiles: AffectedFile[] = [];
  const modulesAffected: ImpactAnalysis['modulesAffected'] = {
    frontend: [],
    backend: [],
    database: [],
    security: [],
    configuration: [],
  };

  for (const id of affectedIds) {
    const node = nodeById.get(id);
    if (!node) continue;

    const bucket: keyof ImpactAnalysis['modulesAffected'] =
      CONFIG_TYPES.has(node.type) || node.group === 'shared' ? 'configuration' : node.group;
    if (!modulesAffected[bucket].includes(node.label)) modulesAffected[bucket].push(node.label);

    if (node.file) {
      affectedFiles.push({
        path: node.file,
        group: node.group,
        reason: reasonFor(node, new Set(classification.seedNodeIds)),
        nodeId: id,
      });
    }
  }

  const affectedPaths = new Set(affectedFiles.map((f) => f.path));
  const affectedScannedFiles = project.files.filter((f) => affectedPaths.has(f.path));
  const tokenOptimization = computeTokenOptimization(project.files, affectedScannedFiles);

  return {
    meta: {
      projectName: graph.meta.projectName,
      generatedAt: new Date().toISOString(),
      generator: 'NexArch Dependency Graph Engine',
    },
    changeRequest,
    classification,
    affectedNodeIds: [...affectedIds],
    affectedFiles,
    modulesAffected,
    unaffectedFileCount: Math.max(0, project.files.length - affectedScannedFiles.length),
    tokenOptimization,
  };
}
