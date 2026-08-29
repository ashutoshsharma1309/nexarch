/**
 * Frontend Engineer — wraps the existing generation engine.
 *
 * `generateFrontend` is unchanged. The adapter's own work is the contract
 * check: Step 7 of the spec asks that the frontend consume the *actual*
 * API, and the only way to mean that is to read the calls the generator
 * emitted and compare them to the contract, rather than trusting that a
 * generator fed the contract must have used it.
 *
 * The check is real. It parses the emitted API client for the method and
 * path of every request and matches each against a declared OpenAPI
 * operation, allowing for the parameter syntax difference between the two
 * (`/products/{id}` versus a template literal). A call with no matching
 * declaration is a HIGH finding, because a frontend calling an endpoint
 * that does not exist is broken in the specific way that is hardest to
 * see: it compiles, it renders, and it fails at runtime.
 */
import { generateFrontend } from '../../frontend-generator/frontend-generator.service.js';
import { auditFrontendContract } from '../lib/contract-audit.js';
import { generateEntityMetadata } from '../../database-designer/lib/entity-metadata-generator.js';
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
import type {
  BackendManifest,
  GeneratedFrontend,
} from '../../frontend-generator/frontend-generator.types.js';

const definition = getAgentDefinition('frontend-engineer');
if (!definition) throw new Error('frontend-engineer is not declared');

const CONFIG_PATHS = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'index.html',
  '.env.example',
  '.gitignore',
  'eslint.config.js',
  'README.md',
]);

function auditAgainstContract(
  frontend: GeneratedFrontend,
  api: OpenApiDocument,
  requirements: RequirementSpec,
): AgentFinding[] {
  const findings: AgentFinding[] = [];
  // The shared audit resolves BASE_PATH constants; an earlier local copy
  // read only literal arguments and audited nothing the generator emits.
  const { undeclared } = auditFrontendContract(frontend.files, api);
  if (undeclared.length > 0) {
    const shown = [...new Set(undeclared.map((c) => `${c.method} ${c.raw}`))].slice(0, 4);
    findings.push({
      severity: 'HIGH',
      category: 'API_CONTRACT',
      title: 'The frontend calls endpoints the contract does not declare',
      description: `${String(undeclared.length)} call(s) have no matching operation: ${shown.join(', ')}. These will 404 at runtime.`,
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  // Pages the product needs but the generator could not build, because the
  // backend never implemented the module behind them.
  const unimplemented = frontend.pages.filter((page) => !page.implemented);
  if (unimplemented.length > 0) {
    findings.push({
      severity: 'MEDIUM',
      category: 'IMPLEMENTATION',
      title: 'Some screens are scaffolds',
      description: `${unimplemented.map((page) => page.name).join(', ')} render placeholders because no implemented backend module backs them.`,
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  const wantsAuth = requirements.modules.some((mod) =>
    /auth|login|sign|role|permission/i.test(mod),
  );
  if (wantsAuth && !frontend.routes.some((route) => route.protected)) {
    findings.push({
      severity: 'HIGH',
      category: 'SECURITY',
      title: 'The requirements ask for authentication and no route is protected',
      description: 'Every generated route is reachable without signing in.',
      targetNodeId: null,
      status: 'OPEN',
    });
  }

  return findings;
}

export const frontendEngineerAgent: Agent<GeneratedFrontend> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<GeneratedFrontend>> {
    const startedAt = Date.now();
    await Promise.resolve();

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    const architecture = input.inputArtifacts['architecture-plan'] as ArchitecturePlan | undefined;
    const database = input.inputArtifacts['database-design'] as DatabaseDesign | undefined;
    const api = input.inputArtifacts['api-contract'] as OpenApiDocument | undefined;
    const backendMeta = input.inputArtifacts['backend-metadata'] as BackendManifest | undefined;

    if (!requirements || !architecture || !api || !backendMeta || !database) {
      throw new AgentError(
        'invalid-input',
        'The frontend engineer requires the requirement spec, architecture plan, database design, API contract and the backend manifest',
      );
    }

    const entityMetadata = generateEntityMetadata(database, requirements);

    const frontend = generateFrontend(
      architecture,
      requirements,
      database,
      api,
      // What the backend *actually* built, not what was planned — a page
      // for a module the backend stubbed must know it is a stub.
      { modules: backendMeta.modules, routes: backendMeta.routes },
      entityMetadata,
    );

    if (frontend.files.length === 0) {
      throw new AgentError('invalid-output', 'The frontend generator emitted no files');
    }
    if (frontend.pages.length === 0) {
      throw new AgentError('invalid-output', 'The frontend generator emitted no pages');
    }

    const findings = auditAgainstContract(frontend, api, requirements);

    const config = frontend.files.filter((file) => CONFIG_PATHS.has(file.path));
    const source = frontend.files.filter((file) => !CONFIG_PATHS.has(file.path));

    return {
      agentId: 'frontend-engineer',
      status: 'succeeded',
      output: frontend,
      artifacts: {
        'frontend-source': { meta: frontend.meta, files: source },
        'frontend-config': { files: config },
        'frontend-metadata': {
          meta: frontend.meta,
          pages: frontend.pages,
          components: frontend.components,
          routes: frontend.routes,
          stores: frontend.stores,
          folderTree: frontend.folderTree,
          stats: frontend.stats,
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
