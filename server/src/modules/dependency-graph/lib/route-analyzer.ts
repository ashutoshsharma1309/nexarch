/**
 * Matches frontend API-service calls to the backend routes they actually
 * hit, producing `calls-api` edges from the frontend file to an
 * `api-endpoint` node. Every generated frontend service follows one of two
 * shapes (see `emit-api.ts`): a `BASE_PATH` constant reused across calls
 * (`apiClient.get(BASE_PATH, …)`, `` apiClient.get(`${BASE_PATH}/${id}`) ``),
 * or a literal path for one-off auth calls (`apiClient.post('/auth/login')`)
 * — both are pattern-matched here rather than parsed, same rationale as
 * `import-analyzer.ts`.
 */
import type { BackendBundle, GraphEdge } from '../dependency-graph.types.js';
import { apiEndpointNodeId, fileNodeId } from './node-id.js';
import type { ScannedFile } from './project-scanner.js';

const CALL_PATTERN =
  /apiClient\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*(?:(BASE_PATH)\b|`([^`]*)`|'([^']*)'|"([^"]*)")/g;
const BASE_PATH_PATTERN = /const\s+BASE_PATH\s*=\s*['"]([^'"]+)['"]/;

function extractBasePath(content: string): string | null {
  return BASE_PATH_PATTERN.exec(content)?.[1] ?? null;
}

function normalizeFrontendPath(basePath: string | null, rawPath: string): string {
  let path = rawPath;
  if (basePath) path = path.replace('${BASE_PATH}', basePath).replace('BASE_PATH', basePath);
  path = path.replace(/\$\{[^}]+\}/g, ':param');
  return path || '/';
}

function normalizeBackendPath(fullPath: string): string {
  const withoutPrefix = fullPath.replace(/^\/api\/v\d+/, '') || '/';
  return withoutPrefix.replace(/\{[a-zA-Z]+\}/g, ':param').replace(/:[a-zA-Z]+/g, ':param');
}

export function buildApiCallEdges(
  files: readonly ScannedFile[],
  backend: BackendBundle,
): GraphEdge[] {
  const normalizedRoutes = backend.routes.map((route) => ({
    route,
    normalizedPath: normalizeBackendPath(route.path),
  }));

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (file.group !== 'frontend' || !file.path.includes('/services/')) continue;
    const basePath = extractBasePath(file.content);

    for (const match of file.content.matchAll(CALL_PATTERN)) {
      const method = match[1];
      const rawPath = match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
      if (!method) continue;
      const normalizedCallPath = normalizeFrontendPath(basePath, rawPath);

      const hit = normalizedRoutes.find(
        (entry) =>
          entry.route.method.toUpperCase() === method.toUpperCase() &&
          entry.normalizedPath === normalizedCallPath,
      );
      if (!hit) continue;

      const from = fileNodeId(file.path);
      const to = apiEndpointNodeId(hit.route.method, hit.route.path);
      const id = `calls-api:${from}->${to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, from, to, type: 'calls-api' });
    }
  }

  return edges;
}
