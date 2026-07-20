/**
 * Emits one generated feature module: DTO, validators (Zod), repository,
 * service, controller, and routes. Non-CRUD modules (no backing Prisma
 * table — e.g. `auth`) get a scaffold controller/router with NotImplemented
 * stubs, matching the platform's own scaffold-module convention, so every
 * OpenAPI path resolves to a real Express route even before Phase 6 fills
 * in authentication.
 */
import { camelCase } from '../../../shared/utils/strings.js';
import type { GeneratedFile } from '../backend-generator.types.js';
import { file } from './file-tree.js';
import { entitySingular } from './project-model.js';
import type { EndpointModel, ModuleModel } from './project-model.js';
import { tsType, zodField } from './type-map.js';

function relativeShared(depth: number): string {
  return '../'.repeat(depth) + 'shared';
}

/* ── DTOs ─────────────────────────────────────────────────────────────── */

function emitDto(mod: ModuleModel): GeneratedFile {
  const entity = mod.entity;
  if (!entity) {
    return file(
      `src/modules/${mod.name}/dto/${mod.name}.dto.ts`,
      'typescript',
      `// ${mod.className} carries no backing entity yet — DTOs land once this module is implemented.\nexport {};\n`,
    );
  }

  const fields = entity.columns.filter(
    (c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name),
  );
  const entityFields = entity.columns.map((c) => `  ${c.field}: ${tsType(c)};`).join('\n');
  const createFields = fields
    .map((c) => {
      const hasDefault = Boolean(c.defaultExpression) || c.enumValues !== undefined;
      const optional = c.nullable || hasDefault ? '?' : '';
      return `  ${c.field}${optional}: ${tsType(c)};`;
    })
    .join('\n');
  const updateFields = fields.map((c) => `  ${c.field}?: ${tsType(c)};`).join('\n');

  // An interface with only a comment body is structurally `{}`, which
  // accepts any non-nullish value — Record<string, never> says "no fields"
  // without tripping @typescript-eslint/no-empty-object-type.
  const singular = entitySingular(entity.entity);
  const createDto = createFields
    ? `export interface Create${singular}Dto {\n${createFields}\n}`
    : `export type Create${singular}Dto = Record<string, never>;`;
  const updateDto = updateFields
    ? `export interface Update${singular}Dto {\n${updateFields}\n}`
    : `export type Update${singular}Dto = Record<string, never>;`;

  return file(
    `src/modules/${mod.name}/dto/${mod.name}.dto.ts`,
    'typescript',
    `/** ${entity.entity} entity shape, mirroring the Prisma model. */
export interface ${entity.entity}Entity {
${entityFields}
}

${createDto}

${updateDto}
`,
  );
}

/* ── Validators (Zod) ─────────────────────────────────────────────────── */

function emitValidators(mod: ModuleModel): GeneratedFile {
  const entity = mod.entity;
  if (!entity) {
    return file(
      `src/modules/${mod.name}/validators/${mod.name}.validators.ts`,
      'typescript',
      `import { z } from 'zod';\n\nexport const listQuerySchema = z.object({\n  page: z.coerce.number().int().min(1).optional(),\n  limit: z.coerce.number().int().min(1).max(100).optional(),\n});\n`,
    );
  }

  const fields = entity.columns.filter(
    (c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name),
  );
  const validationByField = new Map((mod.validation?.fields ?? []).map((f) => [f.field, f]));

  const fieldLine = (c: (typeof fields)[number], partial: boolean): string => {
    // Sourced from validation-rules.json when available, so the generated
    // validator documents exactly the rules the Database Designer derived.
    const rules = validationByField.get(c.field)?.rules ?? [];
    const comment = rules.length > 0 ? `  // ${rules.map((r) => r.message).join(' ')}\n` : '';
    return `${comment}  ${c.field}: ${zodField(c, partial)},`;
  };
  const createLines = fields.map((c) => fieldLine(c, false)).join('\n');
  const updateLines = fields.map((c) => fieldLine(c, true)).join('\n');

  return file(
    `src/modules/${mod.name}/validators/${mod.name}.validators.ts`,
    'typescript',
    `import { z } from 'zod';

/** Field rules sourced from validation-rules.json (Phase 4). */
export const create${entitySingular(entity.entity)}Schema = z.object({
${createLines || '  /* no client-supplied fields */'}
});

export const update${entitySingular(entity.entity)}Schema = z.object({
${updateLines || '  /* no client-supplied fields */'}
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
});
`,
  );
}

/* ── Repository ───────────────────────────────────────────────────────── */

function emitRepository(mod: ModuleModel): GeneratedFile | null {
  const entity = mod.entity;
  if (!entity) return null;
  const singular = entitySingular(entity.entity);
  const modelProp = entity.entity.charAt(0).toLowerCase() + entity.entity.slice(1);

  return file(
    `src/modules/${mod.name}/repositories/${mod.name}.repository.ts`,
    'typescript',
    `import { BaseRepository } from '${relativeShared(3)}/database/base.repository.js';
import type { FindManyArgs } from '${relativeShared(3)}/database/base.repository.js';
import type { ${entity.entity}Entity } from '../dto/${mod.name}.dto.js';

/**
 * Data access for ${entity.entity}. Extends the generic base repository
 * (find/create/update/soft-delete over the '${modelProp}' Prisma model) and
 * adds only what is specific to this entity.
 */
export class ${singular}Repository extends BaseRepository<${entity.entity}Entity> {
  constructor() {
    super('${modelProp}');
  }

  async findManyPaginated(args: FindManyArgs): Promise<${entity.entity}Entity[]> {
    return this.findMany(args);
  }
}
`,
  );
}

/* ── Service ──────────────────────────────────────────────────────────── */

function emitService(mod: ModuleModel): GeneratedFile {
  const entity = mod.entity;
  const singular = entity ? entitySingular(entity.entity) : mod.className;

  if (!entity) {
    return file(
      `src/modules/${mod.name}/services/${mod.name}.service.ts`,
      'typescript',
      `import { NotImplementedError } from '${relativeShared(3)}/errors/app-error.js';

/**
 * ${mod.className} — scaffold service.
 *
 * This module has no backing entity in the current design, so its business
 * logic is not generated. Implement it here once the capability lands.
 */
export class ${mod.className}Service {
  async notImplemented(): Promise<never> {
    throw new NotImplementedError('${mod.className} is not implemented yet');
  }
}
`,
    );
  }

  const searchable = entity.columns
    .filter((c) => !c.references && !c.primaryKey && c.prismaType === 'String' && !c.enumValues)
    .slice(0, 3)
    .map((c) => `'${c.field}'`);
  const sortable = entity.columns.filter((c) => !c.references).map((c) => `'${c.field}'`);

  return file(
    `src/modules/${mod.name}/services/${mod.name}.service.ts`,
    'typescript',
    `import { NotFoundError } from '${relativeShared(3)}/errors/app-error.js';
import { buildOrderBy, buildSearchWhere, pageMeta, parsePagination } from '${relativeShared(3)}/utils/pagination.js';
import type { PageMeta } from '${relativeShared(3)}/types/pagination.js';
import type { Create${singular}Dto, ${entity.entity}Entity, Update${singular}Dto } from '../dto/${mod.name}.dto.js';
import { ${singular}Repository } from '../repositories/${mod.name}.repository.js';

const SORTABLE_FIELDS = [${sortable.join(', ')}] as const;
const SEARCHABLE_FIELDS = [${searchable.join(', ')}] as const;

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

/**
 * Business logic for ${entity.entity}. Controllers call this and nothing
 * else — validation happens at the boundary, persistence happens in the
 * repository; this is the only layer that makes decisions.
 */
export class ${singular}Service {
  private readonly repository = new ${singular}Repository();

  async list(query: ListQuery): Promise<{ items: ${entity.entity}Entity[]; meta: PageMeta }> {
    const pagination = parsePagination(query);
    const where = buildSearchWhere(query, SEARCHABLE_FIELDS);
    const orderBy = buildOrderBy(query, SORTABLE_FIELDS);

    const [items, total] = await Promise.all([
      this.repository.findManyPaginated({ where, skip: pagination.skip, take: pagination.take, orderBy }),
      this.repository.count(where),
    ]);

    return { items, meta: pageMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string): Promise<${entity.entity}Entity> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundError('${entity.entity} not found');
    return record;
  }

  async create(data: Create${singular}Dto): Promise<${entity.entity}Entity> {
    return this.repository.create(data as unknown as Record<string, unknown>);
  }

  async update(id: string, data: Update${singular}Dto): Promise<${entity.entity}Entity> {
    await this.findById(id);
    return this.repository.update(id, data as unknown as Record<string, unknown>);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repository.softDelete(id);
  }
}
`,
  );
}

/* ── Controller ───────────────────────────────────────────────────────── */

function controllerMethodFor(endpoint: EndpointModel, singular: string): string {
  const name = endpoint.handlerName;
  switch (endpoint.kind) {
    case 'list':
      return `  ${name} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.list(req.query as ListQuery);
    sendSuccess(res, result.items, 'OK', { pagination: result.meta });
  });`;
    case 'read':
      return `  ${name} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const record = await this.service.findById(req.params.id as string);
    sendSuccess(res, record);
  });`;
    case 'create':
      return `  ${name} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const record = await this.service.create(req.body as Create${singular}Dto);
    sendCreated(res, record, '${singular} created');
  });`;
    case 'update':
    case 'patch':
      return `  ${name} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const record = await this.service.update(req.params.id as string, req.body as Update${singular}Dto);
    sendSuccess(res, record, '${singular} updated');
  });`;
    case 'remove':
      return `  ${name} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    await this.service.remove(req.params.id as string);
    sendNoContent(res);
  });`;
    default:
      return `  ${name} = asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
    throw new NotImplementedError('${endpoint.handlerName} is not implemented yet');
  });`;
  }
}

function emitController(mod: ModuleModel): GeneratedFile {
  const entity = mod.entity;

  if (!entity) {
    // A module can legitimately have zero endpoints (e.g. a path collision
    // upstream left it with no operations) — imports must reflect that or
    // an empty class body leaves them all unused.
    if (mod.endpoints.length === 0) {
      return file(
        `src/modules/${mod.name}/controllers/${mod.name}.controller.ts`,
        'typescript',
        `/** ${mod.className} — scaffold controller (no operations in this design). */
export class ${mod.className}Controller {}
`,
      );
    }

    const methods = mod.endpoints
      .map(
        (
          e,
        ) => `  ${e.handlerName} = asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
    throw new NotImplementedError('${e.handlerName} is not implemented yet');
  });`,
      )
      .join('\n\n');
    return file(
      `src/modules/${mod.name}/controllers/${mod.name}.controller.ts`,
      'typescript',
      `import type { Request, Response } from 'express';

import { asyncHandler } from '${relativeShared(3)}/http/async-handler.js';
import { NotImplementedError } from '${relativeShared(3)}/errors/app-error.js';

/** ${mod.className} — scaffold controller (no backing entity in this design). */
export class ${mod.className}Controller {
${methods}
}
`,
    );
  }

  const singular = entitySingular(entity.entity);
  const methods = mod.endpoints.map((e) => controllerMethodFor(e, singular)).join('\n\n');
  const kinds = new Set(mod.endpoints.map((e) => e.kind));

  // Only the response helpers and DTO types each present endpoint kind
  // actually calls are imported — an entity with no delete route (Payments,
  // Reviews without moderation, …) must not import sendNoContent unused.
  const responseHelpers = [
    kinds.has('list') || kinds.has('read') || kinds.has('update') || kinds.has('patch')
      ? 'sendSuccess'
      : null,
    kinds.has('create') ? 'sendCreated' : null,
    kinds.has('remove') ? 'sendNoContent' : null,
  ].filter((name): name is string => name !== null);
  const dtoTypes = [
    kinds.has('create') ? `Create${singular}Dto` : null,
    kinds.has('update') || kinds.has('patch') ? `Update${singular}Dto` : null,
  ].filter((name): name is string => name !== null);

  const imports = [
    `import type { Request, Response } from 'express';`,
    '',
    `import { asyncHandler } from '${relativeShared(3)}/http/async-handler.js';`,
    responseHelpers.length > 0
      ? `import { ${responseHelpers.join(', ')} } from '${relativeShared(3)}/http/response.js';`
      : null,
    kinds.has('custom')
      ? `import { NotImplementedError } from '${relativeShared(3)}/errors/app-error.js';`
      : null,
    dtoTypes.length > 0
      ? `import type { ${dtoTypes.join(', ')} } from '../dto/${mod.name}.dto.js';`
      : null,
    `import type { ListQuery } from '../services/${mod.name}.service.js';`,
    `import { ${singular}Service } from '../services/${mod.name}.service.js';`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return file(
    `src/modules/${mod.name}/controllers/${mod.name}.controller.ts`,
    'typescript',
    `${imports}

/**
 * ${mod.className} — thin HTTP layer: validate (via middleware), call the
 * service, shape the response. No business logic lives here.
 */
export class ${mod.className}Controller {
  private readonly service = new ${singular}Service();

${methods}
}
`,
  );
}

/* ── Routes ───────────────────────────────────────────────────────────── */

function routeMiddleware(endpoint: EndpointModel, mod: ModuleModel): string {
  const parts: string[] = [];
  if (endpoint.auth) parts.push('requireAuth');
  // entity-metadata.json restricts delete to specific roles when its
  // permissions are narrower than every role in the system.
  if (endpoint.kind === 'remove' && mod.deleteRoles) {
    parts.push(`requireRoles(${mod.deleteRoles.map((r) => `'${r}'`).join(', ')})`);
  }
  if (endpoint.kind === 'create' && mod.entity) {
    parts.push(`validate({ body: create${entitySingular(mod.entity.entity)}Schema })`);
  } else if ((endpoint.kind === 'update' || endpoint.kind === 'patch') && mod.entity) {
    parts.push(
      `validate({ params: idParamSchema, body: update${entitySingular(mod.entity.entity)}Schema })`,
    );
  } else if ((endpoint.kind === 'read' || endpoint.kind === 'remove') && mod.entity) {
    parts.push('validate({ params: idParamSchema })');
  } else if (endpoint.kind === 'list') {
    parts.push('validate({ query: listQuerySchema })');
  }
  return parts.join(', ');
}

function emitRoutes(mod: ModuleModel): GeneratedFile {
  const entity = mod.entity;
  const controllerVar = 'controller';
  const routerName = `${camelCase(mod.name)}Router`;
  const kinds = new Set(mod.endpoints.map((e) => e.kind));
  const routeLines = mod.endpoints
    .map((e) => {
      const middleware = routeMiddleware(e, mod);
      const args = [middleware, `${controllerVar}.${e.handlerName}`].filter(Boolean).join(', ');
      return `${routerName}.${e.method}('${e.routePath}', ${args});`;
    })
    .join('\n');

  // Only the schemas an endpoint actually validates against are imported —
  // a module with no update route must not import an unused updateSchema.
  const schemaNames = entity
    ? [
        kinds.has('create') ? `create${entitySingular(entity.entity)}Schema` : null,
        kinds.has('read') || kinds.has('update') || kinds.has('patch') || kinds.has('remove')
          ? 'idParamSchema'
          : null,
        kinds.has('list') ? 'listQuerySchema' : null,
        kinds.has('update') || kinds.has('patch')
          ? `update${entitySingular(entity.entity)}Schema`
          : null,
      ].filter((name): name is string => name !== null)
    : kinds.has('list')
      ? ['listQuerySchema']
      : [];
  const validatorImport =
    schemaNames.length > 0
      ? `import { ${schemaNames.join(', ')} } from '../validators/${mod.name}.validators.js';\n`
      : '';

  const needsAuth = mod.endpoints.some((e) => e.auth);
  const needsRoles = mod.endpoints.some((e) => e.kind === 'remove' && mod.deleteRoles);
  const authImports = [needsAuth && 'requireAuth', needsRoles && 'requireRoles']
    .filter(Boolean)
    .join(', ');

  // validate() is only ever emitted alongside a schema reference (see
  // routeMiddleware), so "a schema is needed" and "validate is used" are
  // exactly the same condition.
  const needsValidate = schemaNames.length > 0;
  // A module can legitimately have zero endpoints (e.g. an upstream path
  // collision left it with no operations) — the controller import and
  // instance would otherwise be flagged as unused.
  const hasEndpoints = mod.endpoints.length > 0;
  const controllerImport = hasEndpoints
    ? `import { ${mod.className}Controller } from '../controllers/${mod.name}.controller.js';\n`
    : '';
  const controllerDecl = hasEndpoints
    ? `const ${controllerVar} = new ${mod.className}Controller();\n\n`
    : '';

  return file(
    `src/modules/${mod.name}/routes/${mod.name}.routes.ts`,
    'typescript',
    `import { Router } from 'express';

${needsValidate ? `import { validate } from '${relativeShared(3)}/middleware/validate.js';\n` : ''}${authImports ? `import { ${authImports} } from '${relativeShared(3)}/middleware/auth.js';\n` : ''}${validatorImport}${controllerImport}
export const ${routerName}: Router = Router();
${controllerDecl}${routeLines}
`,
  );
}

/** Emit every file for one module. */
export function emitModule(mod: ModuleModel): GeneratedFile[] {
  const files = [
    emitDto(mod),
    emitValidators(mod),
    emitService(mod),
    emitController(mod),
    emitRoutes(mod),
  ];
  const repository = emitRepository(mod);
  if (repository) files.push(repository);
  return files;
}
