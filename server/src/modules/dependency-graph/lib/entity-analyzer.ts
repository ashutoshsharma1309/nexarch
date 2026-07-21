/**
 * Builds the backend semantic chain: API endpoint → controller → service →
 * repository → Prisma model → database table (the
 * `LoginPage → AuthService → AuthController → UserRepository → User Table`
 * example from the spec, generalized to every module).
 *
 * The controller/service/repository grouping comes from `moduleSlug`
 * (already assigned by the scanner from each file's path); which Prisma
 * model a repository queries is read directly out of its
 * `super('modelProp')` call rather than trusted from stale manifest data —
 * that call site is the same for every entity module *and* the
 * Authentication module Phase 7 fills in, so this generalizes without a
 * special case. Which base path a module is mounted under comes from
 * `src/routes.ts`'s own import/mount lines, for the same reason: it's
 * authoritative regardless of whether a module's folder name matches its
 * URL (`authentication` mounts at `/auth`).
 */
import type { DatabaseDesign } from '../../../shared/types/design.js';
import type { BackendBundle, GraphEdge, GraphNode } from '../dependency-graph.types.js';
import { apiEndpointNodeId, fileNodeId, modelNodeId, tableNodeId } from './node-id.js';
import type { ScannedFile, ScannedProject } from './project-scanner.js';

function pascalCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractModelProp(repositoryContent: string): string | null {
  return /super\(\s*['"]([a-zA-Z0-9]+)['"]\s*\)/.exec(repositoryContent)?.[1] ?? null;
}

function buildModuleBasePathMap(routesFile: ScannedFile | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!routesFile) return map;

  const routerVarToSlug = new Map<string, string>();
  const importRe = /import\s*\{\s*(\w+)Router\s*\}\s*from\s*'\.\/modules\/([^/]+)\/routes\//g;
  for (const match of routesFile.content.matchAll(importRe)) {
    const varName = match[1];
    const slug = match[2];
    if (varName && slug) routerVarToSlug.set(varName, slug);
  }

  const useRe = /router\.use\('([^']+)',\s*(\w+)Router\)/g;
  for (const match of routesFile.content.matchAll(useRe)) {
    const basePath = match[1];
    const varName = match[2];
    const slug = varName ? routerVarToSlug.get(varName) : undefined;
    if (basePath && slug) map.set(slug, basePath);
  }

  return map;
}

function moduleSlugForRoute(path: string, basePathBySlug: Map<string, string>): string | null {
  const withoutPrefix = path.replace(/^\/api\/v\d+/, '') || '/';
  let best: { slug: string; basePath: string } | null = null;
  for (const [slug, basePath] of basePathBySlug) {
    if (withoutPrefix === basePath || withoutPrefix.startsWith(`${basePath}/`)) {
      if (!best || basePath.length > best.basePath.length) best = { slug, basePath };
    }
  }
  return best?.slug ?? null;
}

export function buildEntityGraph(
  project: ScannedProject,
  backend: BackendBundle,
  database: DatabaseDesign,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const filesBySlug = new Map<string, ScannedFile[]>();
  for (const file of project.files) {
    if (!file.moduleSlug || file.group !== 'backend') continue;
    const list = filesBySlug.get(file.moduleSlug) ?? [];
    list.push(file);
    filesBySlug.set(file.moduleSlug, list);
  }

  const knownTables = new Set(database.tables.map((t) => t.entity));
  const entityByModelProp = new Map(
    database.tables.map((t) => [t.entity.charAt(0).toLowerCase() + t.entity.slice(1), t.entity]),
  );

  for (const [slug, files] of filesBySlug) {
    const controller = files.find((f) => f.kind === 'controller');
    const service = files.find((f) => f.kind === 'service');
    const repository = files.find((f) => f.kind === 'repository');

    if (controller && service) {
      edges.push({
        id: `invokes:${fileNodeId(controller.path)}->${fileNodeId(service.path)}`,
        from: fileNodeId(controller.path),
        to: fileNodeId(service.path),
        type: 'invokes',
      });
    }
    if (service && repository) {
      edges.push({
        id: `queries:${fileNodeId(service.path)}->${fileNodeId(repository.path)}`,
        from: fileNodeId(service.path),
        to: fileNodeId(repository.path),
        type: 'queries',
      });
    }
    if (repository) {
      const modelProp = extractModelProp(repository.content);
      const entity = modelProp ? (entityByModelProp.get(modelProp) ?? pascalCase(modelProp)) : null;
      if (entity) {
        nodes.push({
          id: modelNodeId(entity),
          type: 'prisma-model',
          label: entity,
          group: 'database',
          file: 'prisma/schema.prisma',
          meta: { slug },
        });
        edges.push({
          id: `queries:${fileNodeId(repository.path)}->${modelNodeId(entity)}`,
          from: fileNodeId(repository.path),
          to: modelNodeId(entity),
          type: 'queries',
        });

        if (knownTables.has(entity)) {
          nodes.push({
            id: tableNodeId(entity),
            type: 'db-table',
            label: `${entity} table`,
            group: 'database',
            file: null,
            meta: { entity },
          });
          edges.push({
            id: `maps-to:${modelNodeId(entity)}->${tableNodeId(entity)}`,
            from: modelNodeId(entity),
            to: tableNodeId(entity),
            type: 'maps-to',
          });
        }
      }
    }
  }

  // Foreign-key relationships between tables.
  for (const table of database.tables) {
    for (const column of table.columns) {
      if (!column.references) continue;
      const parentTable = database.tables.find((t) => t.tableName === column.references?.table);
      if (!parentTable || !knownTables.has(parentTable.entity) || !knownTables.has(table.entity))
        continue;
      edges.push({
        id: `depends-on:${tableNodeId(table.entity)}->${tableNodeId(parentTable.entity)}:${column.name}`,
        from: tableNodeId(table.entity),
        to: tableNodeId(parentTable.entity),
        type: 'depends-on',
        label: column.name,
      });
    }
  }

  // API endpoint nodes wired to their controller via the module's mounted base path.
  const routesFile = project.byPath.get('src/routes.ts');
  const basePathBySlug = buildModuleBasePathMap(routesFile);
  for (const route of backend.routes) {
    const slug = moduleSlugForRoute(route.path, basePathBySlug);
    const controller = slug
      ? filesBySlug.get(slug)?.find((f) => f.kind === 'controller')
      : undefined;

    nodes.push({
      id: apiEndpointNodeId(route.method, route.path),
      type: 'api-endpoint',
      label: `${route.method.toUpperCase()} ${route.path}`,
      group: 'backend',
      file: null,
      meta: { auth: route.auth, implemented: route.implemented, moduleSlug: slug },
    });

    const routeFile = slug ? filesBySlug.get(slug)?.find((f) => f.kind === 'route') : undefined;
    if (routeFile) {
      edges.push({
        id: `implements-route:${fileNodeId(routeFile.path)}->${apiEndpointNodeId(route.method, route.path)}`,
        from: fileNodeId(routeFile.path),
        to: apiEndpointNodeId(route.method, route.path),
        type: 'implements-route',
      });
    }
    if (controller) {
      edges.push({
        id: `invokes:${apiEndpointNodeId(route.method, route.path)}->${fileNodeId(controller.path)}`,
        from: apiEndpointNodeId(route.method, route.path),
        to: fileNodeId(controller.path),
        type: 'invokes',
      });
    }
  }

  return { nodes, edges };
}
