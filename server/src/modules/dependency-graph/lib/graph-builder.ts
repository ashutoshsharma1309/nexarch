/**
 * Assembles the full graph: one node per classified file, plus the edges
 * every analyzer contributes (imports, API calls, the backend entity
 * chain), plus a few cross-cutting enrichments too fine-grained for any
 * single analyzer — frontend route → page, page → component retyped as
 * `renders`, environment-variable reads, and JWT `authenticates` edges onto
 * every auth-required endpoint.
 */
import type { DatabaseDesign } from '../../../shared/types/design.js';
import type {
  BackendBundle,
  FrontendBundle,
  GraphEdge,
  GraphNode,
  ModuleGroup,
} from '../dependency-graph.types.js';
import { buildEntityGraph } from './entity-analyzer.js';
import { buildImportEdges } from './import-analyzer.js';
import { envVarNodeId, fileNodeId } from './node-id.js';
import type { ScannedFile, ScannedProject } from './project-scanner.js';
import { buildApiCallEdges } from './route-analyzer.js';

const GROUP_LABEL: Record<ModuleGroup, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  security: 'Security',
  shared: 'Shared',
};

function fileNode(file: ScannedFile): GraphNode | null {
  if (!file.kind) return null;
  return {
    id: fileNodeId(file.path),
    type: file.kind,
    label: file.label,
    group: file.group,
    file: file.path,
    meta: { moduleSlug: file.moduleSlug },
  };
}

const ENV_VAR_PATTERN = /\benv\.([A-Z][A-Z0-9_]*)\b/g;

function envVarNodesAndEdges(files: readonly ScannedFile[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const file of files) {
    for (const match of file.content.matchAll(ENV_VAR_PATTERN)) {
      const name = match[1];
      if (!name) continue;
      const id = envVarNodeId(name);
      if (!nodes.has(id)) {
        nodes.set(id, { id, type: 'env-var', label: name, group: 'backend', file: null, meta: {} });
      }
      edges.push({
        id: `reads-config:${fileNodeId(file.path)}->${id}`,
        from: fileNodeId(file.path),
        to: id,
        type: 'reads-config',
      });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

function frontendRouteEdges(project: ScannedProject, frontend: FrontendBundle): GraphEdge[] {
  const routerFile = project.byPath.get('src/app/router.tsx');
  if (!routerFile) return [];

  const pageByLabel = new Map(
    project.files.filter((f) => f.kind === 'page').map((f) => [f.label, f]),
  );

  const edges: GraphEdge[] = [];
  for (const route of frontend.routes) {
    const page = pageByLabel.get(route.page);
    if (!page) continue;
    edges.push({
      id: `renders:${fileNodeId(routerFile.path)}->${fileNodeId(page.path)}`,
      from: fileNodeId(routerFile.path),
      to: fileNodeId(page.path),
      type: 'renders',
      label: route.path,
    });
  }
  return edges;
}

/** A page importing a component is a render relationship, not a generic import. */
function retypePageComponentImports(edges: GraphEdge[], project: ScannedProject): GraphEdge[] {
  return edges.map((edge) => {
    if (edge.type !== 'imports') return edge;
    const fromPath = edge.from.startsWith('file:') ? edge.from.slice(5) : null;
    const toPath = edge.to.startsWith('file:') ? edge.to.slice(5) : null;
    if (!fromPath || !toPath) return edge;
    const fromFile = project.byPath.get(fromPath);
    const toFile = project.byPath.get(toPath);
    if (fromFile?.kind === 'page' && toFile?.kind === 'component') {
      return { ...edge, id: edge.id.replace('imports:', 'renders:'), type: 'renders' as const };
    }
    return edge;
  });
}

function authenticationEdges(project: ScannedProject, backend: BackendBundle): GraphEdge[] {
  const jwtFile = [...project.byPath.values()].find((f) => f.path === 'src/shared/security/jwt.ts');
  if (!jwtFile) return [];

  return backend.routes
    .filter((route) => route.auth)
    .map((route) => ({
      id: `authenticates:${fileNodeId(jwtFile.path)}->api-endpoint:${route.method.toUpperCase()} ${route.path}`,
      from: fileNodeId(jwtFile.path),
      to: `api-endpoint:${route.method.toUpperCase()} ${route.path}`,
      type: 'authenticates' as const,
    }));
}

export function buildGraphElements(
  project: ScannedProject,
  backend: BackendBundle,
  frontend: FrontendBundle,
  database: DatabaseDesign,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const fileNodes = project.files.map(fileNode).filter((n): n is GraphNode => n !== null);

  const importEdges = retypePageComponentImports(buildImportEdges(project), project);
  const apiCallEdges = buildApiCallEdges(project.files, backend);
  const entityGraph = buildEntityGraph(project, backend, database);
  const routeEdges = frontendRouteEdges(project, frontend);
  const env = envVarNodesAndEdges(project.files);
  const authEdges = authenticationEdges(project, backend);

  const nodes = [...fileNodes, ...entityGraph.nodes, ...env.nodes];
  const edges = [
    ...importEdges,
    ...apiCallEdges,
    ...entityGraph.edges,
    ...routeEdges,
    ...env.edges,
    ...authEdges,
  ];

  // De-duplicate nodes by id (entity-analyzer can emit the same prisma-model
  // / db-table node once per module that touches it).
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return { nodes: [...nodeById.values()], edges };
}

export { GROUP_LABEL };
