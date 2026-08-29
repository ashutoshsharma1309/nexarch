/**
 * The test plan, derived from the project's own priorities.
 *
 * Every case here traces to something the specs already say matters: the
 * health check the architecture promises, the auth flow the requirements
 * ask for, the CRUD surface the backend manifest says is implemented, the
 * validation rules the contract encodes. Nothing is invented to pad the
 * count — Step 3 is explicit that a hundred meaningless tests are worse
 * than ten that would actually catch a regression, so CRUD coverage is
 * capped and each remaining case earns its place.
 *
 * Payloads come from the OpenAPI request schemas, not from guesses: a
 * create test sends exactly the required fields the contract declares,
 * typed the way it declares them. When that payload is rejected, the
 * failure is meaningful — the contract and the implementation disagree
 * about the contract.
 */
import { randomUUID } from 'node:crypto';

import type { JsonSchema, OpenApiDocument } from '../../../shared/types/design.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { TestCase, TestStep } from '../../../shared/types/validation.js';

export interface BackendModuleInfo {
  name: string;
  entity: string | null;
  crud: boolean;
}

export interface BackendRouteInfo {
  method: string;
  path: string;
  auth: boolean;
  implemented: boolean;
}

export interface TestPlanInput {
  projectId: string;
  runId: string;
  api: OpenApiDocument;
  product: ProductSpec | undefined;
  modules: readonly BackendModuleInfo[];
  routes: readonly BackendRouteInfo[];
  authExpected: boolean;
  /** How many CRUD suites to plan. Bounded on purpose. */
  maxCrudModules?: number;
}

/* ── Payload derivation ────────────────────────────────────────────────── */

function resolveRef(api: OpenApiDocument, schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;
  const name = schema.$ref.split('/').pop() ?? '';
  const components = (api as { components?: { schemas?: Record<string, JsonSchema> } }).components;
  return components?.schemas?.[name];
}

function valueFor(name: string, schema: JsonSchema, seed: string): unknown {
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default: {
      if (schema.format === 'uuid') return randomUUID();
      if (schema.format === 'email' || /email/i.test(name)) return `probe.${seed}@test.invalid`;
      if (schema.format === 'date-time' || /(^|_)at$|date/i.test(name)) {
        return new Date().toISOString();
      }
      if (/password/i.test(name)) return `Validate#${seed}A1`;
      const value = `Validation ${name} ${seed}`;
      return schema.maxLength ? value.slice(0, schema.maxLength) : value;
    }
  }
}

/**
 * A minimal valid body for one operation: required fields only, typed as
 * the contract types them. `seed` keeps concurrent validations from
 * colliding on unique columns.
 */
export function payloadFor(
  api: OpenApiDocument,
  path: string,
  method: string,
  seed: string,
): Record<string, unknown> | null {
  const item = (api.paths as Record<string, Record<string, unknown>>)[path];
  const operation = item?.[method.toLowerCase()] as
    { requestBody?: { content?: Record<string, { schema?: JsonSchema }> } } | undefined;
  const schema = resolveRef(api, operation?.requestBody?.content?.['application/json']?.schema);
  if (!schema?.properties) return null;

  const body: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const property = schema.properties[name];
    if (!property) continue;
    body[name] = valueFor(name, property, seed);
  }
  return body;
}

/**
 * The required foreign keys of one create operation, with the entity each
 * references — read from the contract's own field descriptions, which the
 * designer writes as "Foreign key referencing X.".
 */
export function requiredForeignKeys(
  api: OpenApiDocument,
  path: string,
): { field: string; references: string }[] {
  const item = (api.paths as Record<string, Record<string, unknown>>)[path];
  const operation = item?.post as
    { requestBody?: { content?: Record<string, { schema?: JsonSchema }> } } | undefined;
  const schema = resolveRef(api, operation?.requestBody?.content?.['application/json']?.schema);
  if (!schema?.properties) return [];

  const keys: { field: string; references: string }[] = [];
  for (const name of schema.required ?? []) {
    const property = schema.properties[name];
    if (property?.format !== 'uuid') continue;
    const references = /referencing (\w+)/.exec(property.description ?? '')?.[1] ?? '';
    keys.push({ field: name, references });
  }
  return keys;
}

/**
 * The contract path whose POST creates the given entity — how a test finds
 * the endpoint that can satisfy a foreign key.
 */
export function creationPathFor(api: OpenApiDocument, entity: string): string | null {
  for (const [path, item] of Object.entries(api.paths as Record<string, Record<string, unknown>>)) {
    const operation = item.post as
      { requestBody?: { content?: Record<string, { schema?: JsonSchema }> } } | undefined;
    const ref = operation?.requestBody?.content?.['application/json']?.schema?.$ref ?? '';
    if (ref.endsWith(`/${entity}CreateInput`)) return path;
  }
  return null;
}

/* ── Plan derivation ───────────────────────────────────────────────────── */

function makeCase(
  input: TestPlanInput,
  fields: Pick<TestCase, 'name' | 'type' | 'priority' | 'target' | 'expectedResult'> & {
    steps: TestStep[];
  },
): TestCase {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    runId: input.runId,
    agentId: 'test-engineer',
    status: 'PENDING',
    duration: null,
    error: null,
    evidence: null,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/** The base path of one module's collection endpoint, from the live routes. */
export function collectionPathOf(
  routes: readonly BackendRouteInfo[],
  moduleName: string,
): string | null {
  const slug = moduleName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates = routes.filter(
    (route) =>
      route.method.toUpperCase() === 'GET' &&
      !(route.path.split('/').pop() ?? '').includes(':') &&
      route.path
        .toLowerCase()
        .replace(/[^a-z0-9/]/g, '')
        .includes(slug),
  );
  const exact = candidates.find((route) => (route.path.split('/').pop() ?? '') !== '');
  return exact?.path.replace(/^\/api\/v\d+/, '') ?? null;
}

/** A guarded collection GET from the live route list, prefix stripped. */
function guardedCollectionPath(routes: readonly BackendRouteInfo[]): string | null {
  const route = routes.find(
    (entry) =>
      entry.method.toUpperCase() === 'GET' &&
      entry.auth &&
      !(entry.path.split('/').pop() ?? '').includes(':'),
  );
  return route ? route.path.replace(/^\/api\/v\d+/, '') : null;
}

export function deriveTestPlan(input: TestPlanInput): TestCase[] {
  const cases: TestCase[] = [];
  const maxCrud = input.maxCrudModules ?? 3;

  /* Smoke: is anything alive at all. */
  cases.push(
    makeCase(input, {
      name: 'Backend answers its health check',
      type: 'SMOKE',
      priority: 'CRITICAL',
      target: 'health',
      steps: [{ action: 'GET /health', expect: '200 with a database check' }],
      expectedResult: 'The backend serves and reports its dependencies.',
    }),
    makeCase(input, {
      name: 'Frontend serves its application shell',
      type: 'SMOKE',
      priority: 'CRITICAL',
      target: 'frontend',
      steps: [{ action: 'GET the frontend root', expect: '200 with the app mount point' }],
      expectedResult: 'A browser would receive the application.',
    }),
  );

  /* Auth flow, when the requirements ask for one. */
  if (input.authExpected) {
    cases.push(
      makeCase(input, {
        name: 'A new user can register and sign in',
        type: 'API',
        priority: 'CRITICAL',
        target: 'authentication',
        steps: [
          { action: 'POST /auth/register with disposable credentials', expect: '2xx' },
          { action: 'POST /auth/login with the same credentials', expect: '2xx and a token' },
        ],
        expectedResult: 'The front door works.',
      }),
      makeCase(input, {
        name: 'A protected route rejects an unauthenticated request',
        type: 'API',
        priority: 'HIGH',
        target: 'authorization',
        steps: [
          {
            // A real guarded route from this project — an earlier version
            // wrote a placeholder here and the executor probed "/",
            // failing the test against a perfectly guarded application.
            action: `GET ${guardedCollectionPath(input.routes) ?? '/'} without credentials`,
            expect: '401',
          },
        ],
        expectedResult: 'Guards actually guard.',
      }),
    );
  }

  /*
   * CRUD per implemented module, capped — FK-free creates first.
   *
   * A module whose create requires a foreign key can only be tested after
   * its parent exists, so modules creatable in isolation lead. This
   * ordering came from a live run: the first plan led with a cart whose
   * create requires a user id, on a project where users are only born
   * through a scaffolded register — a guaranteed failure that said nothing
   * about the cart.
   */
  const ranked = [...input.modules.filter((module) => module.crud)].sort((a, b) => {
    const fkCount = (module: BackendModuleInfo): number => {
      const path = collectionPathOf(input.routes, module.name);
      return path ? requiredForeignKeys(input.api, path).length : 99;
    };
    return fkCount(a) - fkCount(b);
  });
  const crudModules = ranked.slice(0, maxCrud);
  for (const module of crudModules) {
    const path = collectionPathOf(input.routes, module.name);
    if (!path) continue;
    cases.push(
      makeCase(input, {
        name: `${module.name}: create and read back`,
        type: 'API',
        priority: 'HIGH',
        target: module.name,
        steps: [
          { action: `POST ${path} with the contract's required fields`, expect: '2xx with an id' },
          { action: `GET ${path}`, expect: '200 and the created record listed' },
        ],
        expectedResult: 'A write is persisted and readable — the API-to-database path works.',
      }),
    );
  }

  /* Input validation: the contract's rules are enforced, not decorative. */
  const first = crudModules[0];
  if (first) {
    const path = collectionPathOf(input.routes, first.name);
    if (path) {
      cases.push(
        makeCase(input, {
          name: `${first.name}: an empty payload is rejected`,
          type: 'API',
          priority: 'HIGH',
          target: first.name,
          steps: [{ action: `POST ${path} with {}`, expect: '400 or 422, never 2xx or 5xx' }],
          expectedResult:
            'Validation rejects what the contract requires and the server survives it.',
        }),
      );
    }
  }

  /* One end-to-end path, on the module the product cares most about. */
  const e2eModule =
    crudModules.find((module) =>
      (input.product?.journeys ?? []).some((journey) =>
        journey.modules.some(
          (name) =>
            name.toLowerCase().includes(module.name.toLowerCase()) ||
            module.name.toLowerCase().includes(name.toLowerCase()),
        ),
      ),
    ) ?? crudModules[0];
  if (e2eModule) {
    const path = collectionPathOf(input.routes, e2eModule.name);
    if (path) {
      cases.push(
        makeCase(input, {
          name: `End to end: ${e2eModule.name} lifecycle`,
          type: 'E2E',
          priority: 'CRITICAL',
          target: e2eModule.name,
          steps: [
            { action: `POST ${path}`, expect: '2xx with an id' },
            { action: `GET ${path}/:id`, expect: '200 with the created record' },
            { action: `PUT ${path}/:id with a changed field`, expect: '2xx' },
            { action: `GET ${path}/:id again`, expect: '200 reflecting the change' },
          ],
          expectedResult:
            'A record can live a full life through the real API against the real database.',
        }),
      );
    }
  }

  return cases;
}
