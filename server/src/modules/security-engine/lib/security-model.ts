/**
 * The security generation IR. Everything the scanner, OWASP analyzer, RBAC
 * generator and report assembler need is derived once, here, from the
 * design artifacts — the same "derive from the contract, not from a prompt"
 * discipline the Backend and Frontend Generators follow.
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type {
  DatabaseDesign,
  EntityMetadataSet,
  EntityPermission,
  OpenApiDocument,
  TableDesign,
} from '../../../shared/types/design.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type {
  BackendManifest,
  EndpointSecurityAssessment,
  IdentityTableInfo,
} from '../security-engine.types.js';

export interface SecurityEntityModel {
  entity: string;
  tableName: string;
  permissions: EntityPermission[];
  hasOwnerColumn: boolean;
  sensitiveColumns: string[];
}

export interface SecurityModel {
  projectName: string;
  projectType: string;
  apiPrefix: string;
  roles: string[];
  authEnabled: boolean;
  authMethods: string[];
  identity: IdentityTableInfo | null;
  entities: SecurityEntityModel[];
  endpoints: EndpointSecurityAssessment[];
}

const OWNER_FKS = new Set(['user_id', 'owner_id', 'created_by', 'author_id', 'uploaded_by']);
const SENSITIVE_NAME_PATTERN = /password|secret|token|ssn|ipn|creditcard|card_number|cvv|pin\b/i;

function sensitiveColumnsOf(table: TableDesign): string[] {
  return table.columns
    .filter((c) => SENSITIVE_NAME_PATTERN.test(c.field) || SENSITIVE_NAME_PATTERN.test(c.name))
    .map((c) => c.field);
}

/**
 * A table is a plausible identity/user table when it carries both an
 * email-shaped column and a password-shaped column — there is no upstream
 * "this is the auth table" flag (Phase 4 doesn't model authentication), so
 * this is the same kind of name/shape heuristic the rest of the pipeline
 * already relies on (e.g. `OWNER_FKS` in the Database Designer).
 */
function detectIdentityTable(design: DatabaseDesign): IdentityTableInfo | null {
  for (const table of design.tables) {
    const emailColumn = table.columns.find((c) => c.format === 'email' || /email/i.test(c.field));
    const passwordColumn = table.columns.find((c) => /password/i.test(c.field));
    if (!emailColumn || !passwordColumn) continue;

    const roleColumn = table.columns.find(
      (c) => c.enumValues && c.enumValues.length > 0 && /role/i.test(c.field),
    );

    // The generated frontend renders the signed-in user by name (avatars,
    // the account menu, the profile page), so the auth module has to be able
    // to return one.
    const nameColumn = table.columns.find(
      (c) => /^(name|full_?name|display_?name|username)$/i.test(c.name) && !c.enumValues,
    );

    return {
      entity: table.entity,
      tableName: table.tableName,
      emailField: emailColumn.field,
      passwordField: passwordColumn.field,
      roleField: roleColumn?.field ?? null,
      roleValues: roleColumn?.enumValues ?? null,
      displayNameField: nameColumn?.field ?? null,
    };
  }
  return null;
}

function endpointModuleRoles(
  entityModel: SecurityEntityModel | undefined,
  action: EntityPermission['actions'][number],
): string[] {
  if (!entityModel) return [];
  const roles = entityModel.permissions
    .filter((p) => p.actions.includes(action))
    .map((p) => p.role);
  return roles.length > 0 && roles.length < entityModel.permissions.length ? roles : [];
}

function actionOf(method: string, path: string): EntityPermission['actions'][number] | null {
  const hasParam = /\{[a-zA-Z]+\}/.test(path);
  switch (method) {
    case 'GET':
      return 'read';
    case 'POST':
      return hasParam ? null : 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return null;
  }
}

/** Collapse both `{param}` (OpenAPI) and `:param` (Express) into one token
 * so a manifest route and an architecture-planned route compare equal
 * regardless of which style either side happens to use. */
function normalizeRoutePath(path: string): string {
  return path.replace(/\{[a-zA-Z]+\}|:[a-zA-Z]+/g, ':param');
}

function buildImplementedLookup(backendManifest: BackendManifest): Set<string> {
  return new Set(
    backendManifest.routes
      .filter((r) => r.implemented)
      .map((r) => `${r.method.toUpperCase()} ${normalizeRoutePath(r.path)}`),
  );
}

function buildEndpoints(
  architecture: ArchitecturePlan,
  entityByName: Map<string, SecurityEntityModel>,
  implemented: Set<string>,
  apiPrefix: string,
): EndpointSecurityAssessment[] {
  const assessments: EndpointSecurityAssessment[] = [];
  for (const mod of architecture.apiModules) {
    const entityModel = entityByName.get(mod.module);
    for (const endpoint of mod.endpoints) {
      const action = actionOf(endpoint.method, endpoint.path);
      const inferredRoles = action ? endpointModuleRoles(entityModel, action) : [];
      const roles = endpoint.roles && endpoint.roles.length > 0 ? endpoint.roles : inferredRoles;
      const fullPath = `${mod.basePath}${endpoint.path === '/' ? '' : endpoint.path}`.replace(
        /\/{2,}/g,
        '/',
      );

      const notes: string[] = [];
      const sensitiveData = entityModel !== undefined && entityModel.sensitiveColumns.length > 0;
      if (sensitiveData)
        notes.push(`Handles sensitive fields: ${entityModel.sensitiveColumns.join(', ')}`);
      const lookupKey = `${endpoint.method} ${normalizeRoutePath(apiPrefix + fullPath)}`;
      if (!implemented.has(lookupKey)) {
        notes.push('Not yet implemented by the Backend Generator — currently returns 501.');
      }

      assessments.push({
        method: endpoint.method,
        path: fullPath,
        module: mod.module,
        authRequired: endpoint.auth,
        rolesRequired: roles,
        validated: action !== null || endpoint.method === 'POST',
        rateLimited: true,
        sensitiveData,
        notes,
      });
    }
  }
  return assessments;
}

export function buildSecurityModel(
  requirements: RequirementSpec,
  architecture: ArchitecturePlan,
  database: DatabaseDesign,
  openapi: OpenApiDocument,
  entityMetadata: EntityMetadataSet,
  backendManifest: BackendManifest,
): SecurityModel {
  const roles = requirements.roles.length > 0 ? requirements.roles : ['Admin', 'User'];
  const metadataByEntity = new Map(entityMetadata.entities.map((m) => [m.entity, m]));

  const entities: SecurityEntityModel[] = database.tables.map((table) => ({
    entity: table.entity,
    tableName: table.tableName,
    permissions: metadataByEntity.get(table.entity)?.permissions ?? [],
    hasOwnerColumn: table.columns.some((c) => OWNER_FKS.has(c.name)),
    sensitiveColumns: sensitiveColumnsOf(table),
  }));
  const entityByName = new Map(entities.map((e) => [e.entity, e]));
  const apiPrefix = '/api/v1';
  const implemented = buildImplementedLookup(backendManifest);

  return {
    projectName: architecture.meta.projectName,
    projectType: architecture.meta.projectType,
    apiPrefix,
    roles,
    authEnabled: openapi.tags.some((t) => t.name === 'Authentication'),
    authMethods: requirements.authentication,
    identity: detectIdentityTable(database),
    entities,
    endpoints: buildEndpoints(architecture, entityByName, implemented, apiPrefix),
  };
}
