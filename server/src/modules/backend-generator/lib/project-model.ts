/**
 * The generation IR.
 *
 * Everything the emitters need is derived once, here, from the design
 * artifacts — never from a prompt. Modules come from the OpenAPI tags (the
 * contract is the source of truth for what endpoints exist); each module is
 * matched to its Prisma-backed table so CRUD can be fully implemented, and
 * every operation is classified so the emitters know whether to generate a
 * real handler or a scaffold stub.
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type {
  ColumnDesign,
  DatabaseDesign,
  EntityMetadata,
  EntityMetadataSet,
  EntityValidation,
  OpenApiDocument,
  OpenApiOperation,
  TableDesign,
} from '../../../shared/types/design.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { camelCase, kebabCase, pascalCase, singularize } from '../../../shared/utils/strings.js';

export type EndpointKind = 'list' | 'read' | 'create' | 'update' | 'patch' | 'remove' | 'custom';

export interface EndpointModel {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express route path relative to the module base, e.g. `/` or `/:id`. */
  routePath: string;
  /** Full path for documentation, e.g. `/api/v1/products/:id`. */
  fullPath: string;
  operationId: string;
  handlerName: string;
  kind: EndpointKind;
  auth: boolean;
  roles: string[];
  summary: string;
  pathParams: string[];
}

export interface ModuleModel {
  /** kebab-case module + folder name, e.g. `order-items`. */
  name: string;
  /** PascalCase class prefix, e.g. `OrderItems`. */
  className: string;
  /** Base path relative to the API root, e.g. `/order-items`. */
  basePath: string;
  /** The backing table, when the module maps to a Prisma model. */
  entity: TableDesign | null;
  /** Input-relevant columns (business fields, no server-managed columns). */
  inputColumns: ColumnDesign[];
  validation: EntityValidation | null;
  metadata: EntityMetadata | null;
  endpoints: EndpointModel[];
  get crud(): boolean;
  /** Roles allowed to delete, when entity-metadata.json restricts it to a
   * strict subset of all roles. Null means no restriction is generated. */
  get deleteRoles(): string[] | null;
}

export interface ProjectModel {
  projectName: string;
  projectType: string;
  apiPrefix: string;
  modules: ModuleModel[];
  tables: TableDesign[];
  roles: string[];
  authMethods: string[];
}

const SERVER_MANAGED = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

/**
 * Classify by exact route shape, not loose heuristics — a bare POST to a
 * sub-path (`/checkout`, `/webhook`) is a custom action, not "create",
 * even though it happens to lack a path param. Only the canonical CRUD
 * shapes (`/`, `/:id`) get full implementations; everything else is
 * intentionally left as a scaffold stub rather than guessed at.
 */
function classifyEndpoint(method: string, routePath: string): EndpointKind {
  if (method === 'get' && routePath === '/') return 'list';
  if (method === 'get' && routePath === '/:id') return 'read';
  if (method === 'post' && routePath === '/') return 'create';
  if (method === 'put' && routePath === '/:id') return 'update';
  if (method === 'patch' && routePath === '/:id') return 'patch';
  if (method === 'delete' && routePath === '/:id') return 'remove';
  return 'custom';
}

function toExpressPath(openapiPath: string, basePath: string): string {
  const withParams = openapiPath.replace(/\{([a-zA-Z]+)\}/g, ':$1');
  const relative = withParams.slice(basePath.length) || '/';
  return relative.startsWith('/') ? relative : `/${relative}`;
}

/**
 * A module's base path is the longest path-segment prefix shared by every
 * route carrying its tag. Picking "the shortest path, minus a trailing
 * param" instead breaks the moment a module's shortest route is a leaf
 * action (e.g. `/auth/me`) rather than the collection root — that path has
 * no trailing `{param}` to strip, so it would be used unmodified as the
 * base and every sibling route would be sliced against the wrong length.
 */
function moduleBasePath(tag: string, doc: OpenApiDocument): string {
  const paths: string[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const operation of Object.values(item)) {
      if (operation.tags[0] === tag) paths.push(path);
    }
  }
  if (paths.length === 0) return `/${kebabCase(tag)}`;

  const segmentLists = paths.map((p) => p.split('/').filter(Boolean));
  const minLength = Math.min(...segmentLists.map((s) => s.length));
  const common: string[] = [];
  for (let i = 0; i < minLength; i++) {
    const first = segmentLists[0]?.[i];
    if (first === undefined || first.startsWith('{')) break;
    if (!segmentLists.every((segments) => segments[i] === first)) break;
    common.push(first);
  }

  return common.length > 0 ? `/${common.join('/')}` : `/${kebabCase(tag)}`;
}

function pathParamsOf(openapiPath: string): string[] {
  return [...openapiPath.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1] ?? '');
}

/**
 * Guarantee unique, JS-safe handler names within a module. The OpenAPI
 * operationId (Phase 4) is usually already unique, but its naming heuristic
 * can degenerate for non-CRUD action endpoints sharing a method (e.g. every
 * unparameterized POST under /auth/*) — the code generator is the layer
 * responsible for producing valid identifiers no matter what the contract
 * calls the operation, so collisions are resolved here from the route path
 * itself rather than trusting operationId to already be distinct.
 */
function dedupeHandlerNames(endpoints: EndpointModel[]): void {
  const counts = new Map<string, number>();
  for (const endpoint of endpoints)
    counts.set(endpoint.handlerName, (counts.get(endpoint.handlerName) ?? 0) + 1);

  // Reserve every already-unique name first so a disambiguated collision
  // name can never shadow one of them.
  const taken = new Set<string>();
  for (const endpoint of endpoints) {
    if ((counts.get(endpoint.handlerName) ?? 0) === 1) taken.add(endpoint.handlerName);
  }

  for (const endpoint of endpoints) {
    if ((counts.get(endpoint.handlerName) ?? 0) <= 1) continue;

    const segments = endpoint.routePath.split('/').filter((s) => s !== '' && !s.startsWith(':'));
    const tail = segments.at(-1);
    const base = camelCase(`${endpoint.method}-${tail ?? endpoint.kind}`);

    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base}${suffix}`;
      suffix += 1;
    }
    taken.add(candidate);
    endpoint.handlerName = candidate;
  }
}

function isAuthed(operation: OpenApiOperation): boolean {
  return Array.isArray(operation.security) && operation.security.length > 0;
}

function rolesOf(operation: OpenApiOperation): string[] {
  const security = operation.security?.[0];
  if (security && 'bearerAuth' in security && Array.isArray(security.bearerAuth)) {
    return security.bearerAuth;
  }
  return [];
}

export function buildProjectModel(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  design: DatabaseDesign,
  openapi: OpenApiDocument,
  validation: EntityValidation[],
  entityMetadata: EntityMetadataSet,
): ProjectModel {
  const tableByEntity = new Map(design.tables.map((t) => [t.entity, t]));
  const validationByEntity = new Map(validation.map((v) => [v.entity, v]));
  const metadataByEntity = new Map(entityMetadata.entities.map((m) => [m.entity, m]));
  const allRoles = requirements.roles.length > 0 ? requirements.roles : ['Admin', 'User'];

  const modules: ModuleModel[] = [];

  for (const tag of openapi.tags.map((t) => t.name)) {
    const basePath = moduleBasePath(tag, openapi);
    const entity = tableByEntity.get(tag) ?? null;

    const endpoints: EndpointModel[] = [];
    for (const [openapiPath, item] of Object.entries(openapi.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (operation.tags[0] !== tag) continue;
        const routePath = toExpressPath(openapiPath, basePath);
        endpoints.push({
          method: method as EndpointModel['method'],
          routePath,
          fullPath: `/api/v1${openapiPath}`,
          operationId: operation.operationId,
          handlerName: operation.operationId,
          kind: classifyEndpoint(method, routePath),
          auth: isAuthed(operation),
          roles: rolesOf(operation),
          summary: operation.summary,
          pathParams: pathParamsOf(openapiPath),
        });
      }
    }

    dedupeHandlerNames(endpoints);

    const inputColumns = entity ? entity.columns.filter((c) => !SERVER_MANAGED.has(c.name)) : [];
    const metadata = entity ? (metadataByEntity.get(entity.entity) ?? null) : null;

    modules.push({
      name: kebabCase(tag),
      className: pascalCase(tag),
      basePath,
      entity,
      inputColumns,
      validation: entity ? (validationByEntity.get(entity.entity) ?? null) : null,
      metadata,
      endpoints,
      get crud(): boolean {
        return this.entity !== null && this.endpoints.some((e) => e.kind !== 'custom');
      },
      get deleteRoles(): string[] | null {
        if (!metadata) return null;
        const roles = metadata.permissions
          .filter((p) => p.actions.includes('delete'))
          .map((p) => p.role);
        // Only a meaningful restriction when it's a strict, non-empty subset.
        return roles.length > 0 && roles.length < allRoles.length ? roles : null;
      },
    });
  }

  return {
    projectName: architecture.meta.projectName,
    projectType: architecture.meta.projectType,
    apiPrefix: '/api/v1',
    modules,
    tables: design.tables,
    roles: requirements.roles.length > 0 ? requirements.roles : ['Admin', 'User'],
    authMethods: requirements.authentication,
  };
}

/** camelCase model accessor for a table, e.g. `OrderItems` → `orderItems`. */
export function entitySingular(entity: string): string {
  return pascalCase(singularize(entity));
}
