/**
 * Backend Engineer — wraps the existing generation engine.
 *
 * `generateBackend` is unchanged and still deterministic. What this
 * adapter adds is the part an agent owes the mesh and a pipeline stage
 * never had to: it derives its inputs from the *artifacts it was handed*
 * rather than recomputing them, and it checks its own output against the
 * three specs it is supposed to implement.
 *
 * That first point is subtle and load-bearing. The generator needs a
 * Prisma schema, validation rules and entity metadata, all of which
 * `designDatabase` also produces. Calling `designDatabase` again here
 * would recompute them from the *architecture*, and if the database design
 * artifact had since been regenerated the backend would be built against a
 * schema nobody approved. Deriving them from the `database-design`
 * artifact instead means the code always matches the schema of record.
 *
 * The checks in `auditAgainstSpecs` exist because Step 3 of the spec asks
 * for something specific: when implementation needs to depart from the
 * plan, say so rather than departing quietly. An endpoint the contract
 * declares and the generator did not implement is a finding, not a shrug.
 */
import { generateBackend } from '../../backend-generator/backend-generator.service.js';
import { generateEntityMetadata } from '../../database-designer/lib/entity-metadata-generator.js';
import { generatePrismaSchema } from '../../database-designer/lib/prisma-generator.js';
import { generateValidationRules } from '../../database-designer/lib/validation-generator.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign, OpenApiDocument } from '../../../shared/types/design.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { GeneratedProject } from '../../backend-generator/backend-generator.types.js';

const definition = getAgentDefinition('backend-engineer');
if (!definition) throw new Error('backend-engineer is not declared');

/** Files that configure the backend rather than implement it. */
const CONFIG_PATHS = new Set([
  'package.json',
  'tsconfig.json',
  '.env.example',
  '.gitignore',
  'Dockerfile',
  'prisma/schema.prisma',
  'README.md',
]);

/**
 * Every path the contract declares, normalized to how the generator names
 * routes: OpenAPI writes `/products/{id}`, the router writes
 * `/api/v1/products/:id`.
 */
function contractRoutes(api: OpenApiDocument): Set<string> {
  const routes = new Set<string>();
  for (const [path, item] of Object.entries(api.paths)) {
    const normalized = path.replace(/\{([^}]+)\}/g, ':$1');
    for (const method of Object.keys(item)) {
      routes.add(`${method.toUpperCase()} ${normalized}`);
    }
  }
  return routes;
}

function generatedRoutes(backend: GeneratedProject, apiPrefix: string): Set<string> {
  return new Set(
    backend.routes.map((route) => {
      const path = route.path.startsWith(apiPrefix)
        ? route.path.slice(apiPrefix.length)
        : route.path;
      return `${route.method.toUpperCase()} ${path === '' ? '/' : path}`;
    }),
  );
}

/**
 * Checks the emitted backend against the three specs it implements.
 *
 * Deliberately reports rather than repairs. A generator that quietly
 * invented an endpoint or dropped a table would leave the graph, the
 * frontend and the API contract each describing a different system; a
 * finding leaves all four honest and hands the decision to a person.
 */
function auditAgainstSpecs(
  backend: GeneratedProject,
  database: DatabaseDesign,
  api: OpenApiDocument,
  requirements: RequirementSpec,
): AgentFinding[] {
  const findings: AgentFinding[] = [];

  const apiPrefix = backend.routes[0]?.path.match(/^\/api\/v\d+/)?.[0] ?? '/api/v1';
  const declared = contractRoutes(api);
  const emitted = generatedRoutes(backend, apiPrefix);

  const missing = [...declared].filter((route) => !emitted.has(route));
  if (missing.length > 0) {
    findings.push({
      severity: missing.length > declared.size / 2 ? 'HIGH' : 'MEDIUM',
      category: 'API_CONTRACT',
      title: 'The contract declares endpoints the backend does not serve',
      description: `${String(missing.length)} of ${String(declared.size)} declared endpoints have no route: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`,
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  const invented = [...emitted].filter((route) => !declared.has(route));
  if (invented.length > 0) {
    findings.push({
      severity: 'LOW',
      category: 'API_CONTRACT',
      title: 'The backend serves routes the contract does not declare',
      description: `Implementation added ${String(invented.length)} route(s) beyond the contract: ${invented.slice(0, 4).join(', ')}${invented.length > 4 ? ' …' : ''}. Regenerate the contract if these are intended.`,
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  // Entities are the other contract the generator must not quietly change.
  const tables = new Set(database.tables.map((table) => table.entity.toLowerCase()));
  const built = new Set(
    backend.modules.map((mod) => (mod.entity ?? mod.name).toLowerCase()).filter(Boolean),
  );
  const unbacked = [...tables].filter((entity) => !built.has(entity));
  if (unbacked.length > 0) {
    findings.push({
      severity: 'MEDIUM',
      category: 'DATABASE',
      title: 'Schema tables have no backend module',
      description: `${unbacked.join(', ')} exist in the schema but nothing serves them.`,
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  // Security requirements from the requirement spec, checked rather than assumed.
  const wantsAuth =
    requirements.modules.some((mod) => /auth|login|sign|role|permission/i.test(mod)) ||
    (requirements.securityRequirements ?? []).length > 0;
  if (wantsAuth && !backend.routes.some((route) => route.auth)) {
    findings.push({
      severity: 'HIGH',
      category: 'SECURITY',
      title: 'The requirements ask for authentication and no route enforces it',
      description:
        'Every generated route is public. The requirement spec names authentication or access control.',
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  const unimplemented = backend.routes.filter((route) => !route.implemented);
  if (unimplemented.length > 0) {
    findings.push({
      severity: 'LOW',
      category: 'IMPLEMENTATION',
      title: 'Some routes are scaffolds',
      description: `${String(unimplemented.length)} route(s) are generated as stubs because they are not CRUD over a known entity: ${unimplemented
        .slice(0, 4)
        .map((route) => `${route.method} ${route.path}`)
        .join(', ')}`,
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  return findings;
}

export const backendEngineerAgent: Agent<GeneratedProject> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<GeneratedProject>> {
    const startedAt = Date.now();
    await Promise.resolve(); // keeps the signature honest for an async contract

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    const architecture = input.inputArtifacts['architecture-plan'] as ArchitecturePlan | undefined;
    const database = input.inputArtifacts['database-design'] as DatabaseDesign | undefined;
    const api = input.inputArtifacts['api-contract'] as OpenApiDocument | undefined;

    if (!requirements || !architecture || !database || !api) {
      throw new AgentError(
        'invalid-input',
        'The backend engineer requires the requirement spec, architecture plan, database design and API contract',
      );
    }

    // Derived from the *artifacts*, not recomputed from the architecture —
    // see the note at the top of this file.
    const prismaSchema = generatePrismaSchema(database);
    const validationRules = generateValidationRules(database);
    const entityMetadata = generateEntityMetadata(database, requirements);

    const backend = generateBackend(
      architecture,
      requirements,
      database,
      prismaSchema,
      api,
      validationRules.entities,
      entityMetadata,
    );

    if (backend.files.length === 0) {
      throw new AgentError('invalid-output', 'The backend generator emitted no files');
    }
    if (backend.modules.length === 0) {
      throw new AgentError(
        'invalid-output',
        'The backend generator emitted no modules — nothing would serve the API contract',
      );
    }

    const findings = auditAgainstSpecs(backend, database, api, requirements);

    const config = backend.files.filter((file) => CONFIG_PATHS.has(file.path));
    const source = backend.files.filter((file) => !CONFIG_PATHS.has(file.path));

    return {
      agentId: 'backend-engineer',
      status: 'succeeded',
      output: backend,
      artifacts: {
        'backend-source': { meta: backend.meta, files: source },
        'backend-config': { files: config, prismaSchema },
        // The manifest the frontend engineer reads to know what was really
        // built — it consumes this, not the source tree.
        'backend-metadata': {
          meta: backend.meta,
          modules: backend.modules,
          routes: backend.routes,
          folderTree: backend.folderTree,
          stats: backend.stats,
        },
      },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
