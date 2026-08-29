/**
 * Security Engineer — reads the plan and the code, and reports.
 *
 * Two analyses, deliberately kept separate.
 *
 * The existing Security Engine reasons about the *design*: which endpoints
 * require authentication, which roles exist, whether the architecture's
 * security section is coherent. It is good at that and it is wrapped here
 * unchanged, exactly as Step 1 asks.
 *
 * `scanSource` reads the generated *files*, which the design-level engine
 * has never seen — a credential pasted into a config, an `eval` on request
 * data, a cookie without httpOnly. Those cannot be inferred from a plan;
 * they have to be read.
 *
 * This agent modifies nothing. Step 27 is not a soft preference: the
 * existing engine also has an `applySecurity` that generates hardened
 * files, and calling it here would turn a reviewer into a writer and
 * invalidate every finding the other two agents made against the source
 * they were given. Only `analyzeSecurity` is used.
 */
import { analyzeSecurity } from '../../security-engine/security-engine.service.js';
import { generateEntityMetadata } from '../../database-designer/lib/entity-metadata-generator.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import { scanSource } from '../lib/source-security.js';
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
  SecurityAnalysis,
  SecurityFinding,
} from '../../security-engine/security-engine.types.js';

const definition = getAgentDefinition('security-engineer');
if (!definition) throw new Error('security-engineer is not declared');

interface SourceArtifact {
  files: { path: string; content: string }[];
}

interface BackendMetadata {
  modules: { name: string; entity: string | null; crud: boolean; endpoints: number }[];
  routes: { method: string; path: string; implemented: boolean; auth: boolean }[];
}

interface FrontendMetadata {
  pages: {
    name: string;
    route: string;
    kind: string;
    entity: string | null;
    implemented: boolean;
  }[];
}

/** The existing engine's lowercase severities, in the finding contract's. */
const SEVERITY: Record<SecurityFinding['severity'], AgentFinding['severity']> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

/**
 * Translates the design-level engine's findings into the review contract.
 *
 * Confidence is 0.85 rather than 1: these are conclusions drawn from the
 * plan, and a plan can describe a guard the code does not implement or
 * omit one the code does. Certainty belongs to the checks that read files.
 */
function fromDesignAnalysis(analysis: SecurityAnalysis): AgentFinding[] {
  return analysis.report.findings.map((finding) => ({
    type: 'SECURITY' as const,
    severity: SEVERITY[finding.severity],
    category: finding.category.toUpperCase().replace(/-/g, '_'),
    title: finding.title,
    description: finding.owasp
      ? `${finding.description} (OWASP ${finding.owasp})`
      : finding.description,
    evidence: finding.location ? `${finding.location} — ${finding.title}` : null,
    recommendation: finding.recommendation,
    targetNodeId: null,
    targetFile: finding.location,
    confidence: 0.85,
    status: 'OPEN' as const,
  }));
}

export const securityEngineerAgent: Agent<{
  analysis: SecurityAnalysis;
  sourceFindings: number;
}> = {
  definition,

  async execute(
    input: AgentExecutionInput,
  ): Promise<AgentResult<{ analysis: SecurityAnalysis; sourceFindings: number }>> {
    const startedAt = Date.now();
    await Promise.resolve();

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    const architecture = input.inputArtifacts['architecture-plan'] as ArchitecturePlan | undefined;
    const database = input.inputArtifacts['database-design'] as DatabaseDesign | undefined;
    const api = input.inputArtifacts['api-contract'] as OpenApiDocument | undefined;
    const backendMeta = input.inputArtifacts['backend-metadata'] as BackendMetadata | undefined;
    const frontendMeta = input.inputArtifacts['frontend-metadata'] as FrontendMetadata | undefined;

    if (!requirements || !architecture || !database || !api || !backendMeta || !frontendMeta) {
      throw new AgentError(
        'invalid-input',
        'The security engineer requires the requirement spec, architecture, database design, API contract and both generation manifests',
      );
    }

    const analysis = analyzeSecurity({
      requirements,
      architecture,
      database,
      openapi: api,
      entityMetadata: generateEntityMetadata(database, requirements),
      backendManifest: { modules: backendMeta.modules, routes: backendMeta.routes },
      frontendManifest: {
        pages: frontendMeta.pages.map((page) => ({
          name: page.name,
          route: page.route,
          kind: page.kind,
          entity: page.entity,
          implemented: page.implemented,
        })),
      },
    });

    /*
     * Source scanning covers both halves of the project. A credential in
     * a frontend file is worse than one in a backend file — it ships to
     * every visitor — so neither side is skipped.
     */
    const backendSource = input.inputArtifacts['backend-source'] as SourceArtifact | undefined;
    const frontendSource = input.inputArtifacts['frontend-source'] as SourceArtifact | undefined;
    const backendConfig = input.inputArtifacts['backend-config'] as SourceArtifact | undefined;
    const frontendConfig = input.inputArtifacts['frontend-config'] as SourceArtifact | undefined;

    const files = [
      ...(backendSource?.files ?? []).map((f) => ({ ...f, path: `backend/${f.path}` })),
      ...(backendConfig?.files ?? []).map((f) => ({ ...f, path: `backend/${f.path}` })),
      ...(frontendSource?.files ?? []).map((f) => ({ ...f, path: `frontend/${f.path}` })),
      ...(frontendConfig?.files ?? []).map((f) => ({ ...f, path: `frontend/${f.path}` })),
    ];

    if (files.length === 0) {
      throw new AgentError(
        'invalid-input',
        'The security engineer requires generated source to review',
      );
    }

    const authExpected =
      requirements.modules.some((mod) => /auth|login|sign|role|permission|access/i.test(mod)) ||
      (requirements.securityRequirements ?? []).length > 0;

    const sourceFindings = scanSource({ files, authExpected });
    const findings = [...fromDesignAnalysis(analysis), ...sourceFindings];

    return {
      agentId: 'security-engineer',
      status: 'succeeded',
      output: { analysis, sourceFindings: sourceFindings.length },
      artifacts: {
        'security-report': {
          meta: analysis.meta,
          report: analysis.report,
          owasp: analysis.owasp,
          recommendations: analysis.recommendations,
          sourceScan: {
            filesScanned: files.length,
            findings: sourceFindings.length,
            authExpected,
          },
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
