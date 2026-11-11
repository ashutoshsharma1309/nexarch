/**
 * The end-to-end run: one prompt in, a runnable project out.
 *
 *   analysis → research → decision → design intelligence → architecture
 *            → database → backend → frontend → security
 *            → feature implementation → dependencies
 *            → verification → repair → graph
 *
 * Which of those really run is decided per product: a brochure site skips the
 * database and the backend, and verification executes what was generated.
 *
 * Each stage consumes only the previous stage's structured output, and the
 * run object records what each one actually did — status, duration, a
 * one-line summary — so the client renders real state rather than a
 * progress bar counting to a number nobody measured.
 *
 * Runs execute detached from the request: `start()` returns the run in
 * `running` with every stage `pending`, and the client polls. That keeps a
 * 30-second generation off a 15-second HTTP timeout, and it is the same
 * shape the run engine already uses for sessions.
 *
 * Every run belongs to a project. A caller may name one; a caller that does
 * not gets a project derived from the prompt, created on the spot. That
 * keeps the one-prompt flow exactly as it was — type a description, press
 * generate — while making User → Project → Run real underneath it. Stage
 * state stays in memory (see `lib/run-store.ts` for why); the durable half
 * is a `generations` row.
 */
import { randomUUID } from 'node:crypto';
import { closeRun, openRun } from './lib/run-store.js';
import {
  loadRunArtifacts,
  runArtifactsBelongTo,
  saveRunArtifacts,
} from './lib/run-artifact-store.js';

import { logger } from '../../shared/logger/index.js';
import { setLogContext, withLogContext } from '../../shared/logger/context.js';
import { logEvent, startTimer } from '../../shared/logger/events.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { exportMarkdown } from '../architecture/lib/markdown-exporter.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { synchronize as synchronizeGraph } from '../engineering-graph/index.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import { formatEvidenceBrief, researchProduct } from '../web-research/index.js';
import type { ResearchArtifact } from '../web-research/index.js';
import {
  analyzeWithAi,
  deriveProjectName,
  designEntityFields,
  writeSiteDesign,
} from './lib/ai-stages.js';
import { auditDomainRelevance, summarizeRelevance } from './lib/domain-relevance.js';
import { describeAll, isArtifactType, selectArtifact } from './lib/artifact-index.js';
import { buildDesignIntelligence, formatDesignBrief } from './lib/design-intelligence.js';
import {
  decideProduct,
  scopePlan,
  scopeRequirements,
  summarizeDecision,
} from './lib/product-decision.js';
import { RunEvents } from './lib/run-events.js';
import { adoptBilledUsage, restoreRunFromEvents } from './lib/run-rehydration.js';
import { listStageUsage } from '../execution-events/execution-events.service.js';
import { aiConfigured } from './lib/ai-stages.js';
import {
  implementRequestedFeatures,
  reconcileImplementedFlags,
  reconcileServiceClaims,
} from './lib/feature-implementation.js';
import type { FeatureResult } from './lib/feature-implementation.js';
import {
  declaredRoutes,
  describeFailure,
  describeRunOutcome,
  describeVerification,
  hasVerifiedFailure,
  loadVerificationDeps,
  mergeRepairedFiles,
} from './lib/verification-stage.js';
import type { VerificationDeps } from './lib/verification-stage.js';
import type { AiCallStat } from './lib/ai-stages.js';
import type { ArtifactDescriptor } from '../../shared/contracts/artifact.js';
import type {
  PipelineArtifacts,
  PipelineRun,
  PipelineAgentId,
  PipelineStage,
  ResearchAppliedStage,
  RunPhase,
  StageId,
  StartRunInput,
} from './pipeline.types.js';

/**
 * The stages, in order, each with the identity it reports under and what that
 * identity answers for. `engine` says what really does the work, so an entry
 * here can never make a deterministic stage read as an AI agent.
 */
const STAGE_TEMPLATE: readonly {
  id: StageId;
  label: string;
  engine: 'ai' | 'deterministic';
  agentId: PipelineAgentId;
  responsibility: string;
}[] = [
  {
    id: 'analysis',
    label: 'Requirement Analysis',
    engine: 'ai',
    agentId: 'requirement-analyst',
    responsibility: 'Turn the request into a structured requirement.',
  },
  {
    id: 'research',
    label: 'Web Research',
    engine: 'ai',
    agentId: 'research-analyst',
    responsibility: 'Gather real evidence about this domain and any reference sites.',
  },
  {
    id: 'decision',
    label: 'Product Decisions',
    engine: 'deterministic',
    agentId: 'product-architect',
    responsibility: 'Decide from the request which capabilities this product needs.',
  },
  {
    id: 'design-intelligence',
    label: 'Design Intelligence',
    engine: 'deterministic',
    agentId: 'ux-ui-engineer',
    responsibility: 'Derive the design system and page specification from the evidence.',
  },
  {
    id: 'architecture',
    label: 'Architecture Planning',
    engine: 'ai',
    agentId: 'architecture-agent',
    responsibility: 'Plan the modules, pages and entities.',
  },
  {
    id: 'database',
    label: 'Database Design',
    engine: 'deterministic',
    agentId: 'database-architect',
    responsibility: 'Design the tables and the API contract.',
  },
  {
    id: 'backend',
    label: 'Backend Generation',
    engine: 'deterministic',
    agentId: 'backend-engineer',
    responsibility: 'Generate the API from the contract.',
  },
  {
    id: 'frontend',
    label: 'Frontend Generation',
    engine: 'ai',
    agentId: 'frontend-engineer',
    responsibility: 'Write the site design and generate the frontend.',
  },
  {
    id: 'security',
    label: 'Security Hardening',
    engine: 'deterministic',
    agentId: 'security-engineer',
    responsibility: 'Apply and audit the security layer.',
  },
  {
    id: 'feature-implementation',
    label: 'Feature Implementation',
    engine: 'ai',
    agentId: 'feature-implementer',
    responsibility: 'Implement what the request asked for and record which files deliver it.',
  },
  {
    id: 'dependencies',
    label: 'Dependency Graph',
    engine: 'deterministic',
    agentId: 'dependency-analyst',
    responsibility: 'Map how the generated code fits together.',
  },
  {
    id: 'verification',
    label: 'Build Verification',
    engine: 'deterministic',
    agentId: 'runtime-engineer',
    responsibility: 'Install, compile, start and call the generated project.',
  },
  {
    id: 'repair',
    label: 'Repair',
    engine: 'ai',
    agentId: 'repair-engineer',
    responsibility: 'Fix what verification proved broken, then verify again.',
  },
  {
    id: 'graph',
    label: 'Engineering Graph',
    engine: 'deterministic',
    agentId: 'dependency-analyst',
    responsibility: 'Index the delivered project.',
  },
];

/** Runs are process-local, like every other generator cache in this platform. */
const MAX_RUNS = 20;
/** The repair loop's own default; stated so the bound is visible where it is used. */
const MAX_REPAIR_ATTEMPTS = 2;
interface RunEntry {
  run: PipelineRun;
  artifacts: PipelineArtifacts | null;
  ownerId: string | null;
  referenceUrls?: string[] | undefined;
}
const runs = new Map<string, RunEntry>();

/** One timeline per live run, and which of its stages really called a model. */
const timelines = new WeakMap<PipelineRun, { events: RunEvents; modelStages: Set<StageId> }>();

function timelineOf(run: PipelineRun): { events: RunEvents; modelStages: Set<StageId> } {
  let timeline = timelines.get(run);
  if (!timeline) {
    timeline = { events: new RunEvents(run), modelStages: new Set() };
    timelines.set(run, timeline);
  }
  return timeline;
}

/**
 * Resolves a run the caller is allowed to see (Phase 16).
 *
 * A run belongs to the user who started it. "Not yours" is reported as
 * not-found — identical to a run that never existed — so a run id cannot be
 * probed for existence across users. `ownerId` is null only for runs a test
 * starts outside the API; a real request always carries an owner.
 */
function ownedEntry(id: string, ownerId: string | null): RunEntry {
  const entry = runs.get(id);
  if (!entry) throw AppError.notFound('That generation run no longer exists — start a new one');
  if (entry.ownerId !== ownerId) {
    throw AppError.notFound('That generation run no longer exists — start a new one');
  }
  return entry;
}

/**
 * Lifecycle observers.
 *
 * Generating a project and recording that it happened are different jobs
 * with different failure modes: a database that is briefly unreachable must
 * not cost a user their generated application. So the engine announces what
 * it did and does not care who is listening — `lib/run-recorder.ts`
 * subscribes at module wiring time to write the durable row.
 *
 * It also keeps the engine's tests honest: they import this service
 * directly, register nothing, and therefore need no database to exercise
 * the whole pipeline.
 */
export type RunObserver = (run: PipelineRun, phase: RunPhase) => void;

const observers: RunObserver[] = [];

export function observeRuns(observer: RunObserver): void {
  observers.push(observer);
}

function emit(run: PipelineRun, phase: RunPhase): void {
  for (const observer of observers) {
    try {
      observer(run, phase);
    } catch (error) {
      logger.warn('run observer threw', { runId: run.id, phase, error });
    }
  }
}

function newStages(): PipelineStage[] {
  return STAGE_TEMPLATE.map((stage) => ({
    ...stage,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: null,
    error: null,
    degraded: false,
  }));
}

function touch(run: PipelineRun): void {
  run.updatedAt = new Date().toISOString();
}

function stageOf(run: PipelineRun, id: StageId): PipelineStage {
  const stage = run.stages.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`unknown stage "${id}"`);
  return stage;
}

function beginStage(run: PipelineRun, id: StageId): PipelineStage {
  const stage = stageOf(run, id);
  stage.status = 'running';
  stage.startedAt = new Date().toISOString();
  touch(run);
  // Stages run one at a time, so this is safe on the run's own context, and it
  // is what charges each model call inside the stage to the stage.
  setLogContext({ stage: id, agentId: stage.agentId });
  logEvent({ event: 'stage.start', stage: id });
  timelineOf(run).events.stageStarted(stage);
  return stage;
}

/**
 * Emits the end of a stage, from the stage's own measurement.
 *
 * The duration is read off the stage rather than timed again here: the run
 * object and the timeline then agree by construction, instead of carrying two
 * numbers for the same interval that drift apart when one of them is taken a
 * line later. A stage that never began reports zero, which its `skipped`
 * outcome already explains.
 */
function stageEnded(
  stage: PipelineStage,
  outcome: 'completed' | 'skipped' | 'failed',
  reason?: string,
): void {
  logEvent({
    event: 'stage.end',
    stage: stage.id,
    outcome,
    durationMs: stage.durationMs ?? 0,
    ...(reason === undefined ? {} : { reason }),
  });
}

function completeStage(
  run: PipelineRun,
  id: StageId,
  summary: string,
  options: { degraded?: boolean; note?: string | null } = {},
): void {
  const stage = stageOf(run, id);
  stage.status = 'completed';
  stage.completedAt = new Date().toISOString();
  stage.durationMs = stage.startedAt
    ? Date.parse(stage.completedAt) - Date.parse(stage.startedAt)
    : null;
  stage.summary = options.note ? `${summary} — ${options.note}` : summary;
  stage.degraded = options.degraded ?? false;
  // The badge says who did the work, so a stage no model answered is not AI.
  if (stage.engine === 'ai' && !timelineOf(run).modelStages.has(id)) {
    stage.engine = 'deterministic';
  }
  touch(run);
  // A degraded stage completed, and the note is why it was degraded — the
  // one case where a successful stage still has something to explain.
  stageEnded(stage, 'completed', stage.degraded ? (options.note ?? 'degraded') : undefined);
  const timeline = timelineOf(run);
  timeline.events.stageCompleted(stage, timeline.modelStages.has(id));
}

function skipStage(run: PipelineRun, id: StageId, reason: string): void {
  const stage = stageOf(run, id);
  stage.status = 'skipped';
  stage.completedAt = new Date().toISOString();
  stage.summary = reason;
  touch(run);
  stageEnded(stage, 'skipped', reason);
  timelineOf(run).events.stageSkipped(stage, reason);
}

function failRun(run: PipelineRun, id: StageId, error: unknown): void {
  const stage = stageOf(run, id);
  const message = userFacingError(error);
  stage.status = 'failed';
  stage.completedAt = new Date().toISOString();
  stage.error = message;
  for (const other of run.stages) {
    if (other.status === 'pending') other.status = 'skipped';
  }
  run.status = 'failed';
  run.error = `${stage.label} failed: ${message}`;
  touch(run);
  stage.durationMs = stage.startedAt
    ? Date.parse(stage.completedAt) - Date.parse(stage.startedAt)
    : null;
  stageEnded(stage, 'failed', message);
  timelineOf(run).events.stageFailed(stage);
  logger.error('pipeline run failed', { runId: run.id, stage: id, error: message });
}

/**
 * Marks one stage failed and leaves the run alone.
 *
 * Deliberately distinct from `failRun`: a sub-step can fail without making
 * the generated application invalid, and the graph-sync catch below used to
 * record exactly that case with `completeStage` — a failed write reported as
 * a completed stage, so the run claimed a graph it had never written.
 */
function failStage(run: PipelineRun, id: StageId, error: unknown): void {
  failStageWith(run, id, userFacingError(error));
}

function failStageWith(run: PipelineRun, id: StageId, message: string): void {
  const stage = stageOf(run, id);
  stage.status = 'failed';
  stage.completedAt = new Date().toISOString();
  stage.durationMs = stage.startedAt
    ? Date.parse(stage.completedAt) - Date.parse(stage.startedAt)
    : null;
  stage.error = message;
  touch(run);
  stageEnded(stage, 'failed', stage.error);
  timelineOf(run).events.stageFailed(stage);
}

/**
 * Everything a user sees about a failure comes through here. Internal
 * details stay in the server log; the client gets a sentence it can act on.
 */
function userFacingError(error: unknown): string {
  if (AppError.isAppError(error) && error.isOperational) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/401|invalid api key/i.test(message)) return 'The configured AI key was rejected';
  if (/429|rate limit/i.test(message)) return 'The AI provider is rate limiting this key';
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) return 'The AI provider timed out';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return 'The AI provider could not be reached';
  }
  return 'An unexpected error interrupted this stage';
}

/**
 * Checks that a stage produced its artifact before it is allowed to report
 * success.
 *
 * `completeStage` believes whatever summary string it is handed, so a
 * generator that wrote nothing would still record a completed stage reading
 * "0 files · 0 modules" and the run would hand back an empty project as
 * though it were runnable. Throwing routes the stage through the normal
 * failure path, which is the truth. The missing artifact is logged because
 * `userFacingError` keeps an internal fault's text generic on purpose.
 */
function assertProduced(id: StageId, produced: boolean, artifact: string): void {
  if (produced) return;
  logger.error('stage produced no artifact', { stage: id, artifact });
  throw new Error(`${id} stage produced no ${artifact}`);
}

function recordUsage(run: PipelineRun, id: StageId, usage: AiCallStat | null): void {
  if (!usage) return;
  const timeline = timelineOf(run);
  timeline.modelStages.add(id);
  timeline.events.modelCall(stageOf(run, id), usage);
  addToTotals(run, usage);
}

function addToTotals(run: PipelineRun, usage: AiCallStat): void {
  run.ai.calls += 1;
  run.ai.provider = usage.provider;
  run.ai.model = usage.model;
  run.ai.inputTokens += usage.inputTokens;
  run.ai.outputTokens += usage.outputTokens;
  run.ai.estimatedCostUsd = Number((run.ai.estimatedCostUsd + usage.costUsd).toFixed(6));
  if (usage.knownCostUsd === null) run.ai.unpricedCalls = (run.ai.unpricedCalls ?? 0) + 1;
  if (!usage.cacheHit && usage.inputTokens + usage.outputTokens === 0) {
    run.ai.unreportedTokenCalls = (run.ai.unreportedTokenCalls ?? 0) + 1;
  }
}

/**
 * The runnable file set. Generator output overlaid with the Security
 * Engine's hardened files — they share paths on purpose, so the real
 * authentication module replaces the generator's stubs. Running the
 * un-hardened set produces an app whose every route demands a token no
 * endpoint can issue.
 */
/**
 * The runnable file set: generator output with the hardened security files
 * laid over it. Exported because an edit re-assembles the same set from the
 * same parts, and a second copy of this rule would be a second chance to get
 * the precedence backwards.
 */
export function overlayFiles(
  base: { path: string; content: string }[],
  hardened: { path: string; content: string }[],
  prefix: string,
): { path: string; content: string }[] {
  const byPath = new Map(base.map((file) => [file.path, file.content]));
  for (const file of hardened) byPath.set(file.path, file.content);
  return [...byPath.entries()].map(([path, content]) => ({ path: `${prefix}/${path}`, content }));
}

/** The evidence brief, or undefined when research verified nothing. */
function evidenceBrief(research: ResearchArtifact | undefined): string | undefined {
  if (!research || research.findings.length + research.decisions.length === 0) return undefined;
  return formatEvidenceBrief(research);
}

/** Never fails the run: the totals are an account of it, not a part of it. */
async function settleBilledUsage(run: PipelineRun): Promise<void> {
  try {
    adoptBilledUsage(run.ai, await listStageUsage(run.id));
  } catch (error) {
    logger.warn('run usage could not be reconciled', { runId: run.id, error });
  }
}

function recordResearchUsage(run: PipelineRun, research: ResearchArtifact): void {
  for (const call of research.usage.modelCalls) {
    if (call.cacheHit) continue;
    timelineOf(run).modelStages.add('research');
    run.ai.calls += 1;
    // A failed call names no provider, and the last real one is more useful.
    if (call.status !== 'failed') {
      run.ai.provider = call.provider;
      run.ai.model = call.model;
    }
    if (call.costUsd === null) run.ai.unpricedCalls = (run.ai.unpricedCalls ?? 0) + 1;
    if (call.inputTokens === null && call.outputTokens === null) {
      run.ai.unreportedTokenCalls = (run.ai.unreportedTokenCalls ?? 0) + 1;
    }
    run.ai.inputTokens += call.inputTokens ?? 0;
    run.ai.outputTokens += call.outputTokens ?? 0;
    run.ai.estimatedCostUsd = Number((run.ai.estimatedCostUsd + (call.costUsd ?? 0)).toFixed(6));
  }
}

/** One line for the stage, naming what was and was not delivered. */
function summarizeFeatures(result: FeatureResult): { summary: string } {
  const implemented = result.capabilities.filter((entry) => entry.status === 'implemented').length;
  const missing = result.capabilities.filter((entry) => entry.status === 'missing');
  if (result.status === 'not-run') {
    return { summary: result.limitations[0] ?? 'No model was available to implement features.' };
  }
  const counts = `${String(implemented)} of ${String(result.capabilities.length)} capabilities implemented · ${String(result.filesChanged.length)} files changed · ${String(result.stubsRemaining.length)} placeholders remain`;
  return {
    summary:
      missing.length === 0
        ? counts
        : `${counts}. Missing: ${missing
            .slice(0, 4)
            .map((entry) => entry.title)
            .join('; ')}`,
  };
}

async function execute(
  runId: string,
  prompt: string,
  trigger: 'prompt' | 'retry' = 'prompt',
  referenceUrls?: string[],
): Promise<void> {
  const entry = runs.get(runId);
  if (!entry) return;
  const { run } = entry;
  const elapsed = startTimer();
  logEvent({ event: 'run.start', trigger, stages: run.stages.length });
  const { events } = timelineOf(run);
  events.jobStarted();

  try {
    /* Stage 1 — requirement analysis (AI) */
    beginStage(run, 'analysis');
    const analysis = await analyzeWithAi(prompt, run.projectName);
    recordUsage(run, 'analysis', analysis.usage);
    let requirements = analysis.value;
    run.projectName = requirements.projectName;
    completeStage(
      run,
      'analysis',
      `${requirements.projectType} · ${requirements.modules.length} modules · ${requirements.database.length} entities`,
      { degraded: analysis.degraded, note: analysis.note },
    );

    /* Web research: what is really true of this domain, before anything is designed */
    beginStage(run, 'research');
    const applied = new Set<ResearchAppliedStage>();
    let research: ResearchArtifact | undefined;
    try {
      research = await researchProduct({ prompt, spec: requirements, referenceUrls });
    } catch (error) {
      // Research informs the build; a build must not die for want of it.
      logger.warn('web research failed', { runId, error });
      failStage(run, 'research', error);
    }
    const evidence = evidenceBrief(research);
    if (research) {
      recordResearchUsage(run, research);
      events.research(stageOf(run, 'research'), research);
      if (evidence !== undefined) {
        const refined = await analyzeWithAi(prompt, run.projectName, evidence);
        recordUsage(run, 'research', refined.usage);
        if (refined.evidenceApplied === true) {
          requirements = { ...refined.value, projectName: requirements.projectName };
          applied.add('requirements');
        }
      }
      completeStage(
        run,
        'research',
        `${research.status} · ${research.sources.length} sources · ${research.findings.length} findings`,
        { degraded: research.status !== 'complete', note: research.limitations[0] ?? null },
      );
    }

    /* Product decisions: only what this request needs goes any further */
    beginStage(run, 'decision');
    const decision = decideProduct(prompt, {
      appAuthEnabled: config.generation.appAuth,
      integrations: requirements.integrations,
    });
    const scoped = scopeRequirements(requirements, decision, prompt);
    for (const [capability, entry] of [
      ['database', decision.database],
      ['authentication', decision.authentication],
      ['payments', decision.payments],
      ['externalApis', decision.externalApis],
    ] as const) {
      // Payments and integrations are recorded as asked for; nothing builds them.
      const verdict = !entry.needed
        ? 'no'
        : capability === 'payments' || capability === 'externalApis'
          ? 'requested, not built'
          : 'yes';
      events.note('decision', `${capability}: ${verdict}. ${entry.reason}`, {
        capability,
        needed: entry.needed,
        reason: entry.reason,
      });
    }
    completeStage(run, 'decision', summarizeDecision(decision), {
      note: decision.limitations.join(' ') || null,
    });

    /* Design intelligence: the design system and page specification */
    beginStage(run, 'design-intelligence');
    const designIntelligence = buildDesignIntelligence(prompt, research, decision);
    completeStage(
      run,
      'design-intelligence',
      `${designIntelligence.basis} · ${designIntelligence.pageSpec.length} sections specified · ${designIntelligence.measuredReferences} references measured`,
      { degraded: designIntelligence.basis !== 'research' },
    );

    /* Stage 2 — architecture planning (deterministic plan, AI column design) */
    beginStage(run, 'architecture');
    const planned = planArchitecture(scoped);
    const plan = scopePlan(planned.plan, decision);
    // Re-rendered, not reused: it would otherwise document modules just removed.
    const markdown = plan === planned.plan ? planned.markdown : exportMarkdown(plan);
    const fields = decision.backend
      ? await designEntityFields(
          plan.database.entities,
          { projectName: requirements.projectName, projectType: requirements.projectType },
          evidence,
        )
      : null;
    if (fields) {
      recordUsage(run, 'architecture', fields.usage);
      plan.database.entities = fields.value;
      if (fields.evidenceApplied === true) applied.add('entity-fields');
    }
    completeStage(
      run,
      'architecture',
      `${plan.apiModules.length} API modules · ${plan.database.entities.length} entities · ${plan.frontend.pages.length} pages`,
      { degraded: fields?.degraded ?? false, note: fields?.note ?? null },
    );

    /* Stage 3 — database design */
    // A website still needs the empty contract the frontend generator reads.
    const skippedReason = `Not needed: ${decision.database.reason}`;
    if (decision.backend) beginStage(run, 'database');
    const design = designDatabase(plan, scoped);
    if (decision.backend) {
      assertProduced('database', design.prismaSchema.trim() !== '', 'Prisma schema');
      const columnCount = design.databaseDesign.tables.reduce(
        (total, table) => total + table.columns.length,
        0,
      );
      completeStage(
        run,
        'database',
        `${design.integrity.stats.tables} tables · ${columnCount} columns · ${design.integrity.stats.relationships} relationships`,
      );
    } else {
      skipStage(run, 'database', skippedReason);
    }

    /* Stage 4 — backend generation */
    if (decision.backend) beginStage(run, 'backend');
    const generatedBackend = generateBackend(
      plan,
      scoped,
      design.databaseDesign,
      design.prismaSchema,
      design.openapi,
      design.validationRules.entities,
      design.entityMetadata,
    );
    // Not delivered for a website: the runner starts whatever has a package.json.
    const backend = decision.backend
      ? generatedBackend
      : { ...generatedBackend, files: [], modules: [], routes: [] };
    if (decision.backend) {
      assertProduced('backend', backend.files.length > 0, 'files');
      completeStage(
        run,
        'backend',
        `${backend.files.length} files · ${backend.modules.length} modules · ${backend.routes.length} routes`,
      );
      events.filesChanged(
        'backend',
        backend.files.map((file) => `backend/${file.path}`),
        [],
      );
    } else {
      skipStage(run, 'backend', skippedReason);
    }

    /* Stage 5 — frontend generation */
    beginStage(run, 'frontend');
    const backendManifest = { modules: backend.modules, routes: backend.routes };
    // The one model call in this stage: the website's theme and sections.
    const siteInput = {
      evidence: [formatDesignBrief(designIntelligence), evidence]
        .filter((part): part is string => part !== undefined)
        .join('\n\n'),
      researchIncluded: evidence !== undefined,
      hasApplication: decision.backend,
    };
    let siteDesign = await writeSiteDesign(prompt, requirements, [], siteInput);
    recordUsage(run, 'frontend', siteDesign.usage);

    // Then check what came back against what was asked for. A model that
    // writes its own page can also quietly drop half the request, and the
    // build would otherwise succeed with a page nobody asked for. One
    // targeted retry, with the gaps named — bounded, because a loop here is
    // a loop that spends a user's tokens on a model that is not improving.
    let relevance = auditDomainRelevance(prompt, siteDesign.value, {
      modelAvailable: !siteDesign.degraded,
    });
    if (relevance.status === 'INCOMPLETE' && !siteDesign.degraded) {
      const retry = await writeSiteDesign(prompt, requirements, relevance.gaps, siteInput);
      recordUsage(run, 'frontend', retry.usage);
      const retried = auditDomainRelevance(prompt, retry.value, {
        modelAvailable: !retry.degraded,
      });
      // Keep the better attempt, not the later one.
      if (!retry.degraded && retried.passed >= relevance.passed) {
        siteDesign = retry;
        relevance = retried;
      }
    }
    if (siteDesign.evidenceApplied === true) applied.add('site-design');
    for (const claim of siteDesign.removedClaims ?? []) {
      events.note('frontend', `Removed unsupported content: ${claim}`, { removed: claim });
    }
    const frontend = generateFrontend(
      plan,
      scoped,
      design.databaseDesign,
      design.openapi,
      backendManifest,
      design.entityMetadata,
      siteDesign.value,
    );
    assertProduced('frontend', frontend.files.length > 0, 'files');
    completeStage(
      run,
      'frontend',
      `${frontend.files.length} files · ${frontend.pages.length} pages · ${frontend.components.length} components · ${summarizeRelevance(relevance)}`,
      {
        degraded: siteDesign.degraded,
        note:
          siteDesign.note ?? (relevance.status === 'PASS' ? null : summarizeRelevance(relevance)),
      },
    );
    events.filesChanged(
      'frontend',
      frontend.files.map((file) => `frontend/${file.path}`),
      [],
    );

    /* Stage 6 — security hardening */
    beginStage(run, 'security');
    const hardened = applySecurity({
      requirements: scoped,
      architecture: plan,
      database: design.databaseDesign,
      openapi: design.openapi,
      entityMetadata: design.entityMetadata,
      backendManifest,
      frontendManifest: {
        pages: frontend.pages.map((page) => ({
          name: page.name,
          route: page.route,
          kind: page.kind,
          entity: page.entity,
          implemented: page.implemented,
        })),
      },
    });
    // A website has no backend for the hardened server files to overlay.
    const security = decision.backend ? hardened : { ...hardened, backendFiles: [] };
    assertProduced(
      'security',
      security.backendFiles.length + security.frontendFiles.length > 0,
      'hardened files',
    );
    completeStage(
      run,
      'security',
      `grade ${security.report.grade} · score ${security.report.overallScore}/100 · ${security.report.findings.length} open findings · ${security.backendFiles.length + security.frontendFiles.length} hardened files`,
    );

    /* Feature implementation: from scaffold to the product that was asked for */
    beginStage(run, 'feature-implementation');
    const scaffold = [
      ...overlayFiles(backend.files, security.backendFiles, 'backend'),
      ...overlayFiles(frontend.files, security.frontendFiles, 'frontend'),
    ];
    let featureResult: FeatureResult | undefined;
    let builtFiles = scaffold;
    let finalDesign = siteDesign.value;
    const removedClaims = [...(siteDesign.removedClaims ?? [])];
    try {
      const implemented = await implementRequestedFeatures({
        prompt,
        spec: scoped,
        decision,
        files: scaffold,
        evidence,
        aiAvailable: aiConfigured(),
        onUsage: (usage) => {
          recordUsage(run, 'feature-implementation', usage);
        },
        onProgress: (message, data) => {
          events.note('feature-implementation', message, data ?? {});
        },
      });
      featureResult = implemented.result;
      // Copy is written before the code exists; now the code does, so a footer
      // naming a service is checked against what actually calls one.
      const checked = reconcileServiceClaims(finalDesign, implemented.files);
      finalDesign = checked.design;
      removedClaims.push(...checked.removed);
      builtFiles = checked.files;
      if (implemented.result.filesChanged.length > 0) {
        events.filesChanged('feature-implementation', [], implemented.result.filesChanged);
      }
      const feature = summarizeFeatures(implemented.result);
      if (implemented.result.status === 'not-run') {
        skipStage(run, 'feature-implementation', feature.summary);
      } else if (implemented.result.status === 'complete') {
        completeStage(run, 'feature-implementation', feature.summary, {
          degraded: implemented.result.budgetExhausted,
        });
      } else {
        failStageWith(run, 'feature-implementation', feature.summary);
        stageOf(run, 'feature-implementation').summary = feature.summary;
      }
    } catch (error) {
      // The scaffold is still delivered; what the stage did not do is reported.
      logger.warn('feature implementation failed', { runId: run.id, error });
      failStage(run, 'feature-implementation', error);
      stageOf(run, 'feature-implementation').summary = 'Feature implementation could not finish';
    }
    const merged = mergeRepairedFiles({ files: scaffold, backend, frontend, security }, builtFiles);
    const assembled = featureResult ? reconcileImplementedFlags(merged, featureResult) : merged;

    /* Stage 7 — dependency graph */
    beginStage(run, 'dependencies');
    const { bundle: dependencies } = buildDependencyGraphBundle({
      requirements: scoped,
      architecture: plan,
      database: design.databaseDesign,
      backend: {
        files: assembled.backend.files,
        modules: assembled.backend.modules,
        routes: assembled.backend.routes,
      },
      frontend: {
        files: assembled.frontend.files,
        pages: assembled.frontend.pages,
        components: assembled.frontend.components,
        routes: assembled.frontend.routes,
        stores: assembled.frontend.stores,
      },
      security: {
        backendFiles: assembled.security.backendFiles,
        frontendFiles: assembled.security.frontendFiles,
        rbac: { roles: assembled.security.rbac.roles, permissions: assembled.security.permissions },
      },
    });
    assertProduced('dependencies', dependencies.stats.totalNodes > 0, 'graph nodes');
    completeStage(
      run,
      'dependencies',
      `${dependencies.stats.totalNodes} nodes · ${dependencies.stats.totalEdges} edges · ${dependencies.quality.circularDependencies.length} cycles`,
    );

    const generated: PipelineArtifacts = {
      runId: run.id,
      requirements: scoped,
      architecture: plan,
      architectureMarkdown: markdown,
      design,
      backend: assembled.backend,
      frontend: assembled.frontend,
      security: assembled.security,
      dependencies,
      siteDesign: finalDesign,
      files: assembled.files,
      ...(research === undefined ? {} : { research }),
      ...(featureResult === undefined ? {} : { featureImplementation: featureResult }),
      ...(removedClaims.length === 0 ? {} : { removedClaims }),
      researchAppliedTo: [...applied],
      productDecision: decision,
      designIntelligence,
    };

    const persist = async (bundle: PipelineArtifacts): Promise<void> => {
      entry.artifacts = bundle;
      if (run.projectId === null) return;
      // Durably, as well as in memory. Until this existed a restart left the
      // project showing a completed build with no files behind it.
      const stored = await saveRunArtifacts(run.id, run.projectId, bundle);
      if (!stored) {
        logger.warn('this run exists only in memory and will not survive a restart', {
          runId: run.id,
        });
      }
    };
    // Before verification too: installing and building takes minutes, and
    // what was generated should not depend on the machine surviving them.
    await persist(generated);

    const artifacts = await verifyAndRepair(run, generated, backend.routes);
    await persist(artifacts);

    /* Stage 8 — engineering graph */
    beginStage(run, 'graph');
    if (run.projectId === null) {
      // A run started outside the API (a test, a script) has no project to
      // attach a graph to. Skipping is honest; failing the run would not be.
      skipStage(run, 'graph', 'no project attached to this run');
    } else {
      try {
        const sync = await synchronizeGraph(run.projectId, run.id, artifacts);
        completeStage(
          run,
          'graph',
          `${sync.nodeCount} nodes · ${sync.edgeCount} edges · ${sync.nodesCreated} new`,
        );
      } catch (error) {
        // The graph is an index built over the generated project, not part of
        // it: a sync that failed leaves the app just as runnable, so this one
        // stage fails and the run below still completes. Only the stage is
        // marked — completing it, as this path used to, reported a graph that
        // does not exist.
        failStage(run, 'graph', error);
        logger.warn('engineering graph sync failed', { runId: run.id, error });
      }
    }

    await settleBilledUsage(run);
    run.status = 'completed';
    const finalOutcome = describeRunOutcome(artifacts.verification, featureResult);
    run.outcome = finalOutcome.outcome;
    run.outcomeDetail = finalOutcome.detail;
    touch(run);
    emit(run, 'settled');
    const durationMs = elapsed();
    runEnded(run, 'completed', durationMs);
    await events.jobCompleted(durationMs, artifacts.verification?.result.ok ?? null);
    logger.info('pipeline run completed', {
      runId: run.id,
      projectName: run.projectName,
      files: artifacts.files.length,
      aiCalls: run.ai.calls,
      outcome: run.outcome,
    });
  } catch (error) {
    const active = run.stages.find((stage) => stage.status === 'running');
    await settleBilledUsage(run);
    failRun(run, active?.id ?? 'analysis', error);
    emit(run, 'settled');
    runEnded(run, 'failed', elapsed(), userFacingError(error));
    await events.jobFailed(active, userFacingError(error));
  }
}

/**
 * Executes the generated project and, if that proves something broken, gives
 * the repair loop a bounded chance to fix it.
 *
 * A run whose verification fails still completes: the user keeps the files and
 * the stage says exactly what failed, as the graph stage does. Only a passing
 * result is ever recorded as passing.
 */
export async function verifyAndRepair(
  run: PipelineRun,
  artifacts: PipelineArtifacts,
  routes: readonly { method: string; path: string; auth: boolean }[],
  deps?: VerificationDeps,
): Promise<PipelineArtifacts> {
  if (run.projectId === null) {
    const reason = 'no project attached to this run';
    skipStage(run, 'verification', reason);
    skipStage(run, 'repair', reason);
    return artifacts;
  }

  const options = {
    projectId: run.projectId,
    jobId: run.id,
    jobKind: 'RUN' as const,
    routes: declaredRoutes(routes),
  };
  beginStage(run, 'verification');
  let result;
  let tools: VerificationDeps;
  try {
    tools = deps ?? (await loadVerificationDeps());
    result = await tools.verifyProject(artifacts.files, options);
  } catch (error) {
    logger.warn('verification could not run', { runId: run.id, error });
    failStageWith(
      run,
      'verification',
      'The generated project could not be verified on this server',
    );
    skipStage(run, 'repair', 'Verification did not run, so nothing is known to be broken');
    return artifacts;
  }

  const record = (
    verified: typeof result,
    repairAttempts: number,
    repaired: boolean,
    limitations: string[],
  ): NonNullable<PipelineArtifacts['verification']> => ({
    result: verified,
    repairAttempts,
    repaired,
    limitations,
  });

  if (result.ok) {
    completeStage(run, 'verification', describeVerification(result), {
      note: result.limitations[0] ?? null,
    });
    skipStage(run, 'repair', 'Verification passed, so there was nothing to repair');
    return { ...artifacts, verification: record(result, 0, false, result.limitations) };
  }

  failStageWith(run, 'verification', describeFailure(result));
  if (!hasVerifiedFailure(result)) {
    skipStage(run, 'repair', 'No check actually failed; the remaining checks were blocked');
    return { ...artifacts, verification: record(result, 0, false, result.limitations) };
  }

  beginStage(run, 'repair');
  try {
    const repair = await tools.repairVerifiedFailures(artifacts.files, result, {
      ...options,
      maxAttempts: MAX_REPAIR_ATTEMPTS,
    });
    const merged = mergeRepairedFiles(artifacts, repair.files);
    const changed = [...new Set(repair.attempts.flatMap((attempt) => attempt.changedFiles))];
    timelineOf(run).events.filesChanged('repair', [], changed);
    if (repair.usage.length > 0) timelineOf(run).modelStages.add('repair');
    // Their timeline rows were published as they happened.
    for (const call of repair.usage) {
      addToTotals(run, {
        provider: call.provider,
        model: call.model,
        inputTokens: call.inputTokens ?? 0,
        outputTokens: call.outputTokens ?? 0,
        costUsd: call.costUsd ?? 0,
        knownCostUsd: call.costUsd,
        durationMs: call.durationMs,
        attempt: 1,
        cacheHit: call.cacheHit,
      });
    }
    const verification = record(repair.verification, repair.attempts.length, repair.repaired, [
      ...repair.verification.limitations,
      ...repair.limitations,
    ]);
    if (repair.repaired) {
      completeStage(
        run,
        'repair',
        `Fixed in ${repair.attempts.length} attempt(s) · ${changed.length} files changed · re-verified: ${describeVerification(repair.verification)}`,
      );
    } else {
      failStageWith(
        run,
        'repair',
        `Still failing after ${repair.attempts.length} attempt(s): ${describeFailure(repair.verification)}`,
      );
    }
    return { ...merged, verification };
  } catch (error) {
    logger.warn('repair could not run', { runId: run.id, error });
    failStage(run, 'repair', error);
    return { ...artifacts, verification: record(result, 0, false, result.limitations) };
  }
}

/**
 * Closes the run's timeline with the shape of what happened.
 *
 * The counts are taken from the stages as they finally stand, so a reader
 * sees "six completed, one failed, one skipped" without the artifacts and
 * without adding up stage events themselves.
 */
function runEnded(
  run: PipelineRun,
  outcome: 'completed' | 'failed',
  durationMs: number,
  reason?: string,
): void {
  const count = (status: PipelineStage['status']): number =>
    run.stages.filter((stage) => stage.status === status).length;
  logEvent({
    event: 'run.end',
    outcome,
    durationMs,
    completed: count('completed'),
    skipped: count('skipped'),
    failed: count('failed'),
    ...(reason === undefined ? {} : { reason }),
  });
}

export function startRun(
  input: StartRunInput,
  ownerId: string | null = null,
  trigger: 'prompt' | 'retry' = 'prompt',
): PipelineRun {
  const prompt = input.prompt.trim();
  const trimmedName = input.projectName?.trim();
  const projectName =
    trimmedName === undefined || trimmedName === '' ? deriveProjectName(prompt) : trimmedName;
  const now = new Date().toISOString();

  const run: PipelineRun = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    projectName,
    prompt,
    status: 'running',
    stages: newStages(),
    ai: {
      calls: 0,
      provider: 'none',
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  runs.set(run.id, { run, artifacts: null, ownerId, referenceUrls: input.referenceUrls });
  // Oldest first — Map preserves insertion order.
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }

  emit(run, 'started');
  // Forked rather than detached bare: `execute` outlives this request by
  // minutes, and everything it emits — stages, model calls, child processes,
  // the graph sync — should carry the run it belongs to as well as the
  // request that asked for it. The context is what groups the timeline.
  withLogContext(
    { runId: run.id, ...(run.projectId === null ? {} : { projectId: run.projectId }) },
    () => {
      void execute(run.id, prompt, trigger, input.referenceUrls);
    },
  );
  return run;
}

export function getRun(id: string, ownerId: string | null = null): PipelineRun {
  return ownedEntry(id, ownerId).run;
}

/**
 * A run that outlived this process, rebuilt from its recorded events.
 *
 * Live runs still answer from memory. Without this the client's refresh after
 * a restart found nothing, even though the whole timeline was on disk.
 */
export async function getRunDurable(id: string, ownerId: string): Promise<PipelineRun> {
  if (runs.has(id)) return getRun(id, ownerId);
  const restored = await restoreRunFromEvents(id, ownerId, newStages());
  if (!restored) throw AppError.notFound('That generation run no longer exists — start a new one');
  return restored;
}

export function listRuns(ownerId: string | null = null): PipelineRun[] {
  return [...runs.values()]
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => entry.run)
    .reverse();
}

/**
 * The artifact bundle if this process still holds it, or null.
 *
 * Distinct from `getArtifacts`, which throws: a caller assembling optional
 * context wants "not available" as a value it can record, not an exception
 * that aborts the request.
 */
export function getArtifactsIfReady(id: string): PipelineArtifacts | null {
  return runs.get(id)?.artifacts ?? null;
}

/**
 * The bundle for a run, from memory or from storage.
 *
 * The in-memory map holds the last twenty runs of this process; everything
 * older, and everything from before a restart, is read back from the database
 * and cached so the next caller finds it in memory. `null` means it is
 * genuinely unavailable — never written, pruned, or from a build whose shape
 * this one does not read — and callers must say so rather than imply the run
 * produced nothing.
 */
export async function loadArtifacts(
  id: string,
  ownerId: string | null = null,
): Promise<PipelineArtifacts | null> {
  // A null owner is an internal caller that has already resolved the project;
  // a request always names its user, and "not yours" reads as not found.
  const entry = runs.get(id);
  if (ownerId !== null) {
    const owned = entry ? entry.ownerId === ownerId : await runArtifactsBelongTo(id, ownerId);
    if (!owned) return null;
  }
  if (entry?.artifacts) return entry.artifacts;

  const stored = await loadRunArtifacts(id);
  if (!stored) return null;
  if (entry) entry.artifacts = stored;
  return stored;
}

export function getArtifacts(id: string, ownerId: string | null = null): PipelineArtifacts {
  const entry = ownedEntry(id, ownerId);
  if (!entry.artifacts) {
    throw AppError.badRequest(
      entry.run.status === 'failed'
        ? 'This run failed before it produced any artifacts'
        : 'This run is still generating — poll the run until it completes',
    );
  }
  return entry.artifacts;
}

/** Re-runs the same prompt as a fresh run; the failed one stays in history. */
export function retryRun(
  id: string,
  projectId: string | null,
  ownerId: string | null = null,
): PipelineRun {
  const entry = ownedEntry(id, ownerId);
  return startRun(
    {
      prompt: entry.run.prompt,
      projectName: entry.run.projectName,
      projectId: projectId ?? entry.run.projectId ?? undefined,
      referenceUrls: entry.referenceUrls,
    },
    ownerId,
    'retry',
  );
}

/* ── Artifact addressing ──────────────────────────────────────────────── */

/** What this run produced, described without transferring any of it. */
export function listArtifacts(id: string, ownerId: string | null = null): ArtifactDescriptor[] {
  const entry = ownedEntry(id, ownerId);
  if (!entry.artifacts) return [];
  return describeAll(entry.artifacts, entry.run.projectId ?? '', entry.run.createdAt);
}

/** One artifact by type — the selective read the whole-bundle endpoint cannot do. */
export function getArtifact(id: string, type: string, ownerId: string | null = null): unknown {
  if (!isArtifactType(type)) {
    throw AppError.badRequest(`Unknown artifact type "${type}"`);
  }
  const artifacts = getArtifacts(id, ownerId);
  const value = selectArtifact(artifacts, type);
  if (value === null) throw AppError.notFound(`This run produced no "${type}" artifact`);
  return value;
}

/**
 * Record an edited file set as this project's newest run.
 *
 * An edit produces a new version of exactly the thing a run produces — a
 * requirement spec, an architecture, a file set — so it is recorded as a run
 * rather than as a parallel kind of object. That is not bookkeeping for its
 * own sake: Preview, Code, the Knowledge Graph and the project's history all
 * read "the project's latest completed run", and an edit that did not become
 * one would be invisible to every one of them.
 *
 * The stages are supplied by the caller because an edit genuinely did not run
 * the eight generation stages; reporting stages it never ran would be the
 * kind of invented evidence this platform refuses elsewhere.
 */
export async function registerEditedRun(input: {
  projectId: string;
  projectName: string;
  ownerId: string | null;
  /** The instruction that produced this version, kept as the run's prompt. */
  prompt: string;
  artifacts: Omit<PipelineArtifacts, 'runId'>;
  stages: PipelineStage[];
  ai: PipelineRun['ai'];
}): Promise<{ run: PipelineRun; persisted: true } | { run: null; persisted: false }> {
  const now = new Date().toISOString();
  const run: PipelineRun = {
    id: randomUUID(),
    projectId: input.projectId,
    projectName: input.projectName,
    prompt: input.prompt,
    status: 'completed',
    stages: input.stages,
    ai: input.ai,
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  const artifacts: PipelineArtifacts = {
    ...input.artifacts,
    runId: run.id,
    changedAfterBuild: true,
  };

  // Storage first, and nothing is registered until it succeeds.
  //
  // Registering the run and *then* reporting that its files were not stored
  // left the worst possible state behind: a COMPLETED row and an in-memory
  // entry for an edit the user had just been told was not applied. The next
  // edit would baseline off those files, and a restart — which drops the
  // memory but keeps the row — made the project permanently un-editable.
  const persisted = await saveRunArtifacts(run.id, input.projectId, artifacts);
  if (!persisted) return { run: null, persisted: false };

  runs.set(run.id, { run, artifacts, ownerId: input.ownerId });
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }

  await openRun(run.id, input.projectId, input.prompt);
  await closeRun(run.id, 'COMPLETED');
  emit(run, 'settled');
  return { run, persisted: true };
}
