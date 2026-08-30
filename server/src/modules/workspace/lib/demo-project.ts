/**
 * Demo Mode — a deterministic, credential-free showcase (Steps 13–18).
 *
 * The demo has to be safe for a hackathon stage: no real API key, no
 * external system, no customer data, and the same result every time. So it
 * is built from the platform's own *deterministic* generators — the ones
 * that run without a model — over a fixed prompt. Requirement analysis,
 * architecture, database, API, backend and frontend are all pure functions
 * of that prompt, so the demo project is byte-identical on every reset.
 *
 * The one thing a real run has that these deterministic generators do not
 * is findings and a validation verdict, because those come from the review
 * and validation meshes. The demo seeds a small, honest, *synthetic* set
 * of each — clearly the shape a real review produces — plus one repaired
 * finding, so the demo tells the whole story (generate → review → detect →
 * repair → validate) without needing a live model or a running server.
 *
 * Nothing here is marked as anything but a demo: the project name and the
 * package manifest both say so, so it can never be mistaken for a user's
 * real project (Step 18).
 */
import { analyzeRequirements } from '../../analysis/analysis.service.js';
import { planArchitecture } from '../../architecture/architecture.service.js';
import { designDatabase } from '../../database-designer/database-designer.service.js';
import { generateBackend } from '../../backend-generator/backend-generator.service.js';
import { generateFrontend } from '../../frontend-generator/frontend-generator.service.js';
import { writeArtifact } from '../../agent-orchestrator/lib/artifact-store.js';
import {
  beginReview,
  recordFinding,
  setFindingRepairState,
} from '../../agent-orchestrator/lib/finding-store.js';
import { saveRepair, saveSession } from '../../agent-orchestrator/lib/repair-store.js';
import { syncProjectArtifacts } from '../../agent-orchestrator/lib/graph-sync.js';
import type { ArtifactType, AgentFinding } from '../../../shared/contracts/index.js';

export const DEMO_PROJECT_NAME = 'Demo · Project Management SaaS';
export const DEMO_PROMPT =
  'Build a project management SaaS with authentication, projects, tasks, teams, a dashboard and notifications.';

/**
 * A fixed generation instant for the demo.
 *
 * The deterministic generators are pure functions of the prompt in every
 * respect but one: each stamps its output with `new Date()`. Left alone,
 * that single wall-clock field would make two resets of the demo differ,
 * which breaks the one promise the demo makes — that it is byte-identical
 * every time. Pinning it here keeps the demo a fixture, not a moving
 * target, without touching how the generators behave for real projects.
 */
const DEMO_GENERATED_AT = '2026-01-01T00:00:00.000Z';

/** The synthetic findings a real review would surface on this project. */
const DEMO_FINDINGS: (Partial<AgentFinding> & { category: string; fixed?: boolean })[] = [
  {
    type: 'SECURITY',
    severity: 'MEDIUM',
    category: 'CONFIGURATION',
    title: 'CORS defaults to allowing any origin',
    description: 'The generated server allows any origin; restrict it before production.',
    evidence: 'backend/src/app.ts — cors({ origin: "*" })',
    recommendation: 'Restrict the origin to the domains that call this API.',
    confidence: 0.9,
  },
  {
    type: 'DEPENDENCY',
    severity: 'LOW',
    category: 'UNUSED_DEPENDENCY',
    title: 'Unused dependency "left-pad"',
    description: 'Declared in backend/package.json but never imported.',
    evidence: 'backend/package.json — dependencies.left-pad',
    recommendation: 'Remove it.',
    confidence: 0.75,
    fixed: true, // the demo shows this one getting repaired
  },
  {
    type: 'CODE_QUALITY',
    severity: 'LOW',
    category: 'CONTRACT_MISMATCH',
    title: 'A declared endpoint is a scaffold',
    description: 'One route answers 501 until its handler is implemented.',
    evidence: 'api-contract vs backend routes',
    recommendation: 'Implement the scaffolded handler.',
    confidence: 0.9,
  },
];

/**
 * Builds the demo project's whole state under a project id, deterministically.
 *
 * Called on demo creation and on reset — both do the same thing, because
 * the seed is a pure function of the fixed prompt. Any prior demo state on
 * the project is overwritten by the new artifact versions.
 */
export async function seedDemoProject(projectId: string): Promise<{
  findings: number;
  repaired: number;
  artifacts: number;
}> {
  const analysis = analyzeRequirements(DEMO_PROMPT);
  if (analysis.status !== 'COMPLETE') {
    throw new Error('The demo prompt did not analyze — the deterministic analyzer changed shape');
  }
  const spec = analysis.spec;
  const plan = planArchitecture(spec).plan;
  const design = designDatabase(plan, spec);
  const backend = generateBackend(
    plan,
    spec,
    design.databaseDesign,
    design.prismaSchema,
    design.openapi,
    design.validationRules.entities,
    design.entityMetadata,
  );
  const frontend = generateFrontend(
    plan,
    spec,
    design.databaseDesign,
    design.openapi,
    { modules: backend.modules, routes: backend.routes },
    design.entityMetadata,
  );

  // Pin the one non-deterministic field each generator emits so a reset is
  // byte-identical (see DEMO_GENERATED_AT).
  plan.meta.generatedAt = DEMO_GENERATED_AT;
  design.databaseDesign.meta.generatedAt = DEMO_GENERATED_AT;
  backend.meta.generatedAt = DEMO_GENERATED_AT;
  frontend.meta.generatedAt = DEMO_GENERATED_AT;

  const write = (type: ArtifactType, content: unknown): void => {
    writeArtifact({
      projectId,
      runId: 'demo',
      type,
      agentId: 'requirement-analyst',
      agentVersion: 'demo',
      derivedFrom: [],
      content,
    });
  };

  write('requirement-spec', spec);
  write('architecture-plan', plan);
  write('database-design', design.databaseDesign);
  write('api-contract', design.openapi);
  write('backend-metadata', {
    meta: backend.meta,
    modules: backend.modules,
    routes: backend.routes,
    stats: backend.stats,
  });
  write('frontend-metadata', {
    meta: frontend.meta,
    pages: frontend.pages,
    components: frontend.components,
    routes: frontend.routes,
    stats: frontend.stats,
  });
  write('validation-summary', demoValidation(projectId));

  // The graph, built from the demo artifacts by the same sync the real
  // pipeline uses.
  const artifactMap: Partial<Record<ArtifactType, unknown>> = {
    'requirement-spec': spec,
    'architecture-plan': plan,
    'database-design': design.databaseDesign,
    'api-contract': design.openapi,
    'backend-metadata': { modules: backend.modules, routes: backend.routes, stats: backend.stats },
    'frontend-metadata': {
      pages: frontend.pages,
      components: frontend.components,
      stats: frontend.stats,
    },
  };
  await syncProjectArtifacts(projectId, 'demo', artifactMap);

  // Findings, including one that gets "repaired" so the demo tells the
  // whole detect → repair story.
  const version = beginReview(projectId);
  let repaired = 0;
  for (const finding of DEMO_FINDINGS) {
    const { record } = recordFinding({
      projectId,
      runId: 'demo',
      agentId: 'security-engineer',
      reviewVersion: version,
      finding: {
        type: finding.type ?? 'GENERAL',
        severity: finding.severity ?? 'LOW',
        category: finding.category,
        title: finding.title ?? 'Finding',
        description: finding.description ?? '',
        targetNodeId: null,
        targetFile: null,
        evidence: finding.evidence ?? null,
        recommendation: finding.recommendation ?? null,
        confidence: finding.confidence ?? 1,
        status: 'OPEN',
      },
    });
    if (finding.fixed) {
      setFindingRepairState(projectId, record.id, 'FIXED');
      repaired += 1;
    }
  }

  seedDemoRepairSession(projectId, repaired);

  return { findings: DEMO_FINDINGS.length, repaired, artifacts: 7 };
}

function demoValidation(projectId: string): unknown {
  return {
    projectId,
    runId: 'demo',
    generatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    rows: [
      { name: 'Build', status: 'PASS', detail: 'backend exit 0 · frontend exit 0' },
      { name: 'Type Check', status: 'PASS', detail: 'backend exit 0' },
      { name: 'Lint', status: 'PASS', detail: 'backend exit 0' },
      { name: 'Startup', status: 'PASS', detail: 'backend running · frontend running' },
      { name: 'Health', status: 'PASS', detail: 'health answered' },
      { name: 'Integration', status: 'PASS', detail: '6/6 checks · endpoints probed' },
      { name: 'Tests', status: 'PASS', detail: '8/8 passed' },
    ],
    tests: { total: 8, passed: 8, failed: 0, blocked: 0, skipped: 0, failedCritical: 0 },
    gate: 'PASSED_WITH_WARNINGS',
    gateReason: 'Core checks passed; low-severity findings remain.',
    agents: [],
  };
}

function seedDemoRepairSession(projectId: string, repaired: number): void {
  saveSession({
    id: 'demo-repair',
    projectId,
    status: 'COMPLETED',
    finalState: 'PASSED_WITH_WARNINGS',
    stopReason: 'Repaired the unused dependency; remaining findings are low severity.',
    counts: {
      considered: DEMO_FINDINGS.length,
      autoRepairable: repaired,
      fixed: repaired,
      rejected: 0,
      requiresReview: 0,
      notRepairable: 0,
      rolledBack: 0,
      repairLoops: 0,
    },
    tokens: { input: 0, output: 0, context: 0 },
    startedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    completedAt: new Date('2026-01-01T00:01:00.000Z').toISOString(),
    activeFindingId: null,
  });
  saveRepair({
    id: 'demo-repair-1',
    projectId,
    findingId: 'demo',
    findingTitle: 'Unused dependency "left-pad"',
    severity: 'LOW',
    agentId: 'repair-engineer',
    eligibility: {
      eligibility: 'AUTO_REPAIRABLE',
      reason: 'Removing an unused declaration is mechanical.',
    },
    rootCause: null,
    plan: null,
    attempts: [],
    changeset: null,
    result: 'FIXED',
    rolledBack: false,
    tokens: { input: 0, output: 0, context: 0 },
    durationMs: 12,
    createdAt: new Date('2026-01-01T00:00:30.000Z').toISOString(),
  });
}
