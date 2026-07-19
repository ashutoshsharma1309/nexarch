/**
 * OpenAPIGenerator: builds an OpenAPI 3.1 contract from the API modules the
 * Architecture Planner produced and the entity schemas the Database Designer
 * produced — the two stages meeting in one document. Every module gets its
 * REST operations with request/response bodies, standard error responses,
 * auth requirements, and (for list endpoints) pagination, sorting, filtering
 * and search parameters. Component schemas are derived from the real columns,
 * so the contract can never drift from the database.
 */
import type {
  ApiEndpoint,
  ApiModulePlan,
  ArchitecturePlan,
} from '../../../shared/types/architecture.js';
import { pascalCase, singularize } from '../../../shared/utils/strings.js';
import type {
  ColumnDesign,
  DatabaseDesign,
  JsonSchema,
  JsonSchemaType,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiResponse,
  TableDesign,
} from '../database-designer.types.js';

const SERVER_MANAGED = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

/* ── Column → JSON Schema ────────────────────────────────────────────── */

function baseType(column: ColumnDesign): JsonSchemaType {
  switch (column.prismaType) {
    case 'Int':
      return 'integer';
    case 'Decimal':
      return 'number';
    case 'Boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

function columnSchema(column: ColumnDesign, applyNullable: boolean): JsonSchema {
  const type = baseType(column);
  const schema: JsonSchema = {};

  if (applyNullable && column.nullable) schema.type = [type, 'null'];
  else schema.type = type;

  if (column.enumValues) schema.enum = column.enumValues;
  if (column.format === 'uuid') schema.format = 'uuid';
  else if (column.format === 'email') schema.format = 'email';
  else if (column.format === 'uri') schema.format = 'uri';
  else if (column.format === 'date') schema.format = 'date';
  else if (column.prismaType === 'DateTime') schema.format = 'date-time';

  const maxLength = /^VARCHAR\((\d+)\)$/.exec(column.sqlType);
  if (maxLength?.[1]) schema.maxLength = Number(maxLength[1]);
  if (column.nonNegative) schema.minimum = 0;
  schema.description = column.description;
  return schema;
}

function entitySchema(table: TableDesign): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const column of table.columns) {
    properties[column.field] = columnSchema(column, true);
    if (!column.nullable) required.push(column.field);
  }
  return { type: 'object', properties, required };
}

function inputSchema(table: TableDesign, partial: boolean): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const column of table.columns) {
    if (SERVER_MANAGED.has(column.name)) continue;
    properties[column.field] = columnSchema(column, false);
    const hasDefault = Boolean(column.defaultExpression) || column.enumValues !== undefined;
    if (!partial && !column.nullable && !hasDefault) required.push(column.field);
  }
  return partial ? { type: 'object', properties } : { type: 'object', properties, required };
}

/* ── Operation building ──────────────────────────────────────────────── */

function toOpenApiPath(path: string): string {
  return path.replace(/:([a-zA-Z]+)/g, '{$1}');
}

function hasPathParam(path: string): boolean {
  return path.includes(':');
}

function operationId(endpoint: ApiEndpoint, module: string): string {
  const singular = pascalCase(singularize(module));
  const plural = pascalCase(module);
  if (endpoint.method === 'GET')
    return hasPathParam(endpoint.path) ? `get${singular}` : `list${plural}`;
  if (endpoint.method === 'POST') {
    const tail = endpoint.path.split('/').pop() ?? '';
    if (
      !hasPathParam(endpoint.path) &&
      tail !== module.toLowerCase() &&
      !/^[a-z-]+$/.test(module.toLowerCase())
    ) {
      return `${endpoint.method.toLowerCase()}${pascalCase(tail)}`;
    }
    return `create${singular}`;
  }
  if (endpoint.method === 'PUT') return `update${singular}`;
  if (endpoint.method === 'PATCH') return `patch${singular}`;
  return `delete${singular}`;
}

function errorRef(code: string): { $ref: string } {
  return { $ref: `#/components/responses/${code}` };
}

function successResponse(description: string, schemaRef: JsonSchema): OpenApiResponse {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: schemaRef,
            meta: { type: 'object' },
          },
          required: ['success', 'data'],
        },
      },
    },
  };
}

const SHARED_PARAMETERS: Record<string, OpenApiParameter> = {
  PageParam: {
    name: 'page',
    in: 'query',
    description: '1-based page number.',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  },
  LimitParam: {
    name: 'limit',
    in: 'query',
    description: 'Page size (max 100).',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  },
  SortParam: {
    name: 'sort',
    in: 'query',
    description: 'Field to sort by.',
    required: false,
    schema: { type: 'string' },
  },
  OrderParam: {
    name: 'order',
    in: 'query',
    description: 'Sort direction.',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  },
  SearchParam: {
    name: 'search',
    in: 'query',
    description: 'Full-text search term.',
    required: false,
    schema: { type: 'string' },
  },
};

/** Inline copies of the shared list parameters (valid OpenAPI, no $ref needed). */
function listQueryParameters(): OpenApiParameter[] {
  return Object.values(SHARED_PARAMETERS).map((param) => ({ ...param }));
}

function pathParam(name: string): OpenApiParameter {
  return {
    name,
    in: 'path',
    description: `${name} of the resource.`,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  };
}

interface BuildContext {
  entity: TableDesign | undefined;
  module: string;
}

function buildOperation(endpoint: ApiEndpoint, ctx: BuildContext): OpenApiOperation {
  const isCollection = !hasPathParam(endpoint.path);
  const operation: OpenApiOperation = {
    operationId: operationId(endpoint, ctx.module),
    summary: endpoint.description,
    tags: [ctx.module],
    responses: {},
  };

  if (endpoint.auth) {
    operation.security = [{ bearerAuth: [] }];
  }

  const parameters: OpenApiParameter[] = [];
  const pathMatches = endpoint.path.match(/:([a-zA-Z]+)/g) ?? [];
  for (const match of pathMatches) parameters.push(pathParam(match.slice(1)));
  if (endpoint.method === 'GET' && isCollection) parameters.push(...listQueryParameters());
  if (parameters.length > 0) operation.parameters = parameters;

  const entityName = ctx.entity?.entity ?? pascalCase(singularize(ctx.module));

  // Request body.
  if (endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH') {
    const schemaName =
      endpoint.method === 'POST' ? `${entityName}CreateInput` : `${entityName}UpdateInput`;
    const schema: JsonSchema = ctx.entity
      ? { $ref: `#/components/schemas/${schemaName}` }
      : { type: 'object' };
    operation.requestBody = {
      required: endpoint.method !== 'PATCH',
      content: { 'application/json': { schema } },
    };
  }

  // Responses.
  const dataSchema: JsonSchema = ctx.entity
    ? { $ref: `#/components/schemas/${entityName}` }
    : { type: 'object' };

  if (endpoint.method === 'GET' && isCollection) {
    operation.responses['200'] = successResponse('Paginated list.', {
      type: 'array',
      items: dataSchema,
    });
  } else if (endpoint.method === 'DELETE') {
    operation.responses['204'] = { description: 'Deleted.' };
  } else if (endpoint.method === 'POST' && !hasPathParam(endpoint.path)) {
    operation.responses['201'] = successResponse('Created.', dataSchema);
  } else {
    operation.responses['200'] = successResponse('Success.', dataSchema);
  }

  if (endpoint.auth) {
    operation.responses['401'] = errorRef('Unauthorized');
    operation.responses['403'] = errorRef('Forbidden');
  }
  if (hasPathParam(endpoint.path)) operation.responses['404'] = errorRef('NotFound');
  if (endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH') {
    operation.responses['422'] = errorRef('ValidationError');
  }
  operation.responses['429'] = errorRef('RateLimited');
  operation.responses['500'] = errorRef('ServerError');

  return operation;
}

function buildPaths(
  modules: readonly ApiModulePlan[],
  design: DatabaseDesign,
): Record<string, OpenApiPathItem> {
  const paths: Record<string, OpenApiPathItem> = {};
  const tableByEntity = new Map(design.tables.map((t) => [t.entity, t]));

  for (const module of modules) {
    const entity = tableByEntity.get(module.module);
    for (const endpoint of module.endpoints) {
      const key = toOpenApiPath(endpoint.path);
      const item: OpenApiPathItem = paths[key] ?? {};
      const method = endpoint.method.toLowerCase() as keyof OpenApiPathItem;
      item[method] = buildOperation(endpoint, { entity, module: module.module });
      paths[key] = item;
    }
  }
  return paths;
}

/* ── Components ───────────────────────────────────────────────────────── */

function buildSchemas(design: DatabaseDesign): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {
    ApiError: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: { field: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
          required: ['code', 'message'],
        },
      },
      required: ['success', 'error'],
    },
  };

  for (const table of design.tables) {
    schemas[table.entity] = entitySchema(table);
    schemas[`${table.entity}CreateInput`] = inputSchema(table, false);
    schemas[`${table.entity}UpdateInput`] = inputSchema(table, true);
  }
  return schemas;
}

function errorResponse(description: string): OpenApiResponse {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
  };
}

export function generateOpenApi(
  architecture: ArchitecturePlan,
  design: DatabaseDesign,
): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: `${architecture.meta.projectName} API`,
      version: '1.0.0',
      description: `REST contract for the ${architecture.meta.projectType} application, generated by NexArch from the architecture plan and database design.`,
    },
    servers: [{ url: '/api/v1', description: 'Versioned API root' }],
    tags: architecture.apiModules.map((module) => ({
      name: module.module,
      description: `${module.module} operations`,
    })),
    paths: buildPaths(architecture.apiModules, design),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      parameters: SHARED_PARAMETERS,
      responses: {
        Unauthorized: errorResponse('Authentication required.'),
        Forbidden: errorResponse('Insufficient permissions.'),
        NotFound: errorResponse('Resource not found.'),
        Conflict: errorResponse('Conflicts with an existing resource.'),
        ValidationError: errorResponse('Request validation failed.'),
        RateLimited: errorResponse('Too many requests.'),
        ServerError: errorResponse('Unexpected server error.'),
      },
      schemas: buildSchemas(design),
    },
  };
}
