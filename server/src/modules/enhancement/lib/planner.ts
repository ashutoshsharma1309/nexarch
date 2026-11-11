/**
 * From a request to a plan someone can read before anything changes.
 *
 * Retrieval, impact, optional research, then one model call over a bounded
 * slice of the project. The plan is checked against the real file list and
 * against what this kind of change must cover before it is shown.
 */
import { randomUUID } from 'node:crypto';

import { AppError } from '../../../shared/utils/app-error.js';
import { logger } from '../../../shared/logger/index.js';
import type { EditImpact } from '../../project-editor/project-editor.types.js';
import type { PipelineArtifacts } from '../../pipeline/pipeline.types.js';
import type {
  CoverageArea,
  EnhancementKind,
  EnhancementPlan,
  EnhancementResearchInfo,
  ModelCallUsage,
  PlanRecordResearch,
} from '../enhancement.types.js';
import { assembleContext, excerptsForPrompt, scoreFiles } from './context-retrieval.js';
import type { ContextBundle } from './context-retrieval.js';
import {
  capabilityAlreadyPresent,
  evaluateCoverage,
  missingAreas,
  requiresFunctionalCheck,
} from './coverage.js';
import type { EnhancementDeps } from './deps.js';
import { classifyInstruction, decideResearch } from './intent.js';
import { parseModelJson, parsePlan } from './plan-parser.js';
import type { ParsedPlan } from './plan-parser.js';
import { modelCaller } from './usage.js';
import type { ModelCaller } from './usage.js';

const AGENT_ID = 'enhancement-planner';
const SUBSTANTIAL_KINDS: readonly EnhancementKind[] = [
  'add-authentication',
  'add-database',
  'add-backend',
  'add-module',
  'integrate-api',
  'redesign-page',
  'refactor',
];
const SUBSTANTIAL_FILE_COUNT = 3;

export interface CreatedPlan {
  plan: EnhancementPlan;
  artifacts: PipelineArtifacts;
  usage: ModelCallUsage[];
  research: PlanRecordResearch | null;
}

async function architectureContext(
  deps: EnhancementDeps,
  input: { ownerId: string; projectId: string; runId: string; instruction: string },
  candidates: readonly string[],
  limitations: string[],
): Promise<string> {
  try {
    const context = await deps.buildContext(input.ownerId, {
      projectId: input.projectId,
      runId: input.runId,
      taskType: 'CODE_REVIEW',
      instruction: input.instruction,
      targetNames: candidates.slice(0, 10),
      includeDependencies: true,
      includeDependents: true,
    });
    return context.text;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    limitations.push(`The architecture context could not be compiled: ${reason}`);
    return 'No architecture context is available. Plan from the files shown.';
  }
}

function impactForPrompt(impact: EditImpact): string {
  if (impact.graphUnavailable) {
    return `No dependency evidence: ${impact.graphUnavailableReason ?? 'the graph has nothing for these files'}`;
  }
  const rows = [...impact.dependents, ...impact.tests]
    .slice(0, 40)
    .map(
      (entry) => `- ${entry.name} (${entry.type}, depth ${String(entry.depth)}): ${entry.reason}`,
    );
  return rows.length === 0 ? 'The graph shows nothing depending on these files.' : rows.join('\n');
}

async function gatherResearch(
  deps: EnhancementDeps,
  input: {
    instruction: string;
    research?: boolean | undefined;
    referenceUrls?: readonly string[] | undefined;
  },
  kind: EnhancementKind,
  artifacts: PipelineArtifacts,
  usage: ModelCallUsage[],
): Promise<{ info: EnhancementResearchInfo; record: PlanRecordResearch | null }> {
  const references = input.referenceUrls ?? [];
  const decision = decideResearch({
    kind,
    instruction: input.instruction,
    // Naming a site is asking for it to be looked at, unless told not to.
    explicit: input.research ?? (references.length > 0 ? true : undefined),
    providersConfigured: deps.researchConfigured(),
  });
  if (!decision.run) {
    return {
      info: {
        outcome: decision.unavailable === true ? 'skipped' : 'not-needed',
        reason: decision.reason,
        sourceCount: 0,
        findingCount: 0,
        limitations: decision.unavailable === true ? [decision.reason] : [],
      },
      record: null,
    };
  }
  const artifact = await deps.research({
    prompt: input.instruction,
    spec: artifacts.requirements,
    ...(references.length > 0 ? { referenceUrls: references } : {}),
  });
  for (const call of artifact.usage.modelCalls) {
    usage.push({
      stage: 'researching',
      agentId: 'web-research',
      provider: call.provider,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: call.costUsd,
      durationMs: call.durationMs,
      cacheHit: call.cacheHit,
    });
  }
  return {
    info: {
      outcome: 'ran',
      reason: decision.reason,
      sourceCount: artifact.sources.length,
      findingCount: artifact.findings.length,
      limitations: artifact.limitations,
    },
    record: { artifact, brief: deps.formatBrief(artifact) },
  };
}

function isSubstantial(kind: EnhancementKind, parsed: ParsedPlan): boolean {
  return (
    SUBSTANTIAL_KINDS.includes(kind) ||
    parsed.files.length > SUBSTANTIAL_FILE_COUNT ||
    parsed.files.some((file) => file.action !== 'modify') ||
    parsed.risks.length > 0
  );
}

/** What is still missing from a plan, in words the model can act on. */
function gapsOf(
  kind: EnhancementKind,
  coverage: readonly CoverageArea[],
  parsed: ParsedPlan,
): string[] {
  const gaps = missingAreas(coverage).map((area) => `No planned file covers: ${area.label}.`);
  const needed = requiresFunctionalCheck(kind);
  if (needed !== null && !parsed.functionalChecks.some((check) => check.kind === needed)) {
    gaps.push(`A "${needed}" entry in functionalChecks is required for this change.`);
  }
  return gaps;
}

async function askForPlan(
  call: ModelCaller,
  variables: Record<string, string>,
  evidence: string | undefined,
  existing: ReadonlySet<string>,
): Promise<ParsedPlan> {
  const response = await call(
    {
      promptId: 'enhance-plan',
      variables,
      complexity: 'large-planning',
      schema: 'generic-json',
      ...(evidence === undefined ? {} : { untrustedData: evidence }),
    },
    { stage: 'planning', agentId: AGENT_ID, maxOutputTokens: 6_144 },
  );
  return parsePlan(parseModelJson(response.content), existing);
}

function requiredCoverageText(kind: EnhancementKind, baseline: readonly string[]): string {
  const areas = evaluateCoverage(kind, []);
  if (areas.length === 0) return 'No fixed areas for this kind of change.';
  return (
    areas.map((area) => `- ${area.label}`).join('\n') +
    (capabilityAlreadyPresent(kind, baseline)
      ? '\nThe project already has files in each of these areas, so extend them rather than replacing them.'
      : '')
  );
}

function promptVariables(
  input: { instruction: string },
  kind: EnhancementKind,
  artifacts: PipelineArtifacts,
  architecture: string,
  impact: EditImpact,
  bundle: ContextBundle,
  baseline: readonly string[],
): Record<string, string> {
  return {
    INSTRUCTION: input.instruction,
    KIND: kind,
    PROJECT_SUMMARY: `${artifacts.requirements.projectName} (${artifacts.requirements.projectType}): ${artifacts.requirements.goal ?? 'no stated goal'}`,
    ARCHITECTURE_CONTEXT: architecture,
    IMPACT: impactForPrompt(impact),
    MANIFEST: bundle.manifest.join('\n'),
    EXCERPTS: excerptsForPrompt(bundle) || 'No file matched the request.',
    REQUIRED_COVERAGE: requiredCoverageText(kind, baseline),
    GAP_NOTE: '',
  };
}

export async function createPlan(
  input: {
    projectId: string;
    ownerId: string;
    instruction: string;
    research?: boolean | undefined;
    referenceUrls?: readonly string[] | undefined;
  },
  deps: EnhancementDeps,
): Promise<CreatedPlan> {
  await deps.project(input.ownerId, input.projectId);
  const { runId, artifacts } = await deps.baseline(input.projectId);
  const kind = classifyInstruction(input.instruction);
  const limitations: string[] = [];
  const usage: ModelCallUsage[] = [];
  const call = modelCaller(deps.generate, (entry) => usage.push(entry));

  const scored = scoreFiles(artifacts.files, input.instruction, kind);
  const bundle = assembleContext(artifacts.files, scored);
  const baselinePaths = artifacts.files.map((file) => file.path);
  const existing = new Set(baselinePaths);

  const architecture = await architectureContext(
    deps,
    { ...input, runId },
    bundle.candidates,
    limitations,
  );
  const candidateImpact = await deps.impact(
    input.ownerId,
    input.projectId,
    bundle.candidates.slice(0, 12),
  );
  const { info: research, record } = await gatherResearch(deps, input, kind, artifacts, usage);
  limitations.push(...research.limitations);

  const variables = promptVariables(
    input,
    kind,
    artifacts,
    architecture,
    candidateImpact,
    bundle,
    baselinePaths,
  );
  let parsed = await askForPlan(call, variables, record?.brief, existing);
  let coverage = evaluateCoverage(
    kind,
    parsed.files.map((file) => file.path),
    baselinePaths,
  );
  let gaps = gapsOf(kind, coverage, parsed);

  if (gaps.length > 0 || parsed.files.length === 0) {
    // One correction. A plan still short after being told exactly what is
    // missing is reported as unappliable, not retried until it looks right.
    logger.info('enhancement plan needs a correction', { kind, gaps: gaps.length });
    const note = [
      ...gaps,
      ...(parsed.files.length === 0 ? ['The plan named no usable files.'] : []),
    ];
    parsed = await askForPlan(
      call,
      {
        ...variables,
        GAP_NOTE: `## Your previous plan was incomplete\n\n${note.map((gap) => `- ${gap}`).join('\n')}`,
      },
      record?.brief,
      existing,
    );
    coverage = evaluateCoverage(
      kind,
      parsed.files.map((file) => file.path),
      baselinePaths,
    );
    gaps = gapsOf(kind, coverage, parsed);
  }

  if (parsed.files.length === 0) {
    throw AppError.badRequest(
      'No file changes could be planned for that request. Try naming the page or feature to change.',
    );
  }
  limitations.push(...gaps.map((gap) => `This plan cannot be applied yet: ${gap}`));
  limitations.push(...parsed.rejected.map((entry) => `Left out of the plan: ${entry}`));
  if (capabilityAlreadyPresent(kind, baselinePaths)) {
    limitations.push('The project already has this capability, so this plan extends it.');
  }

  const planned = parsed.files.map((file) => file.path);
  const touchedExisting = parsed.files
    .filter((file) => file.action !== 'create')
    .map((file) => file.path);
  const impact = await deps.impact(input.ownerId, input.projectId, touchedExisting);
  // Brand-new files have no graph nodes by definition; that is not a gap.
  if (touchedExisting.length > 0 && impact.graphUnavailable && impact.graphUnavailableReason) {
    limitations.push(impact.graphUnavailableReason);
  }
  if (parsed.envChanges.length > 0 && !planned.some((path) => path.endsWith('.env.example'))) {
    limitations.push(
      `This change needs ${parsed.envChanges.map((env) => env.name).join(', ')}, but no .env.example is in the plan, so they will not be documented.`,
    );
  }

  const plan: EnhancementPlan = {
    planId: randomUUID(),
    projectId: input.projectId,
    instruction: input.instruction,
    summary: parsed.summary || 'Planned file changes for this request.',
    steps: parsed.steps,
    filesLikelyTouched: planned,
    limitations,
    createdAt: new Date().toISOString(),
    kind,
    basedOnRunId: runId,
    files: parsed.files,
    impact,
    substantial: isSubstantial(kind, parsed),
    risks: parsed.risks,
    envChanges: parsed.envChanges,
    research,
    coverage,
    functionalChecks: parsed.functionalChecks,
    validationPlan: [
      'Install, type-check, build and start the changed project',
      'Check its health and routes',
      ...parsed.functionalChecks.map((check) =>
        check.kind === 'auth'
          ? 'Register, log in, reach a protected route and log out against the running app'
          : `Create, read, update and delete a ${check.resource} against the running app`,
      ),
    ],
    status: 'planned',
  };
  return { plan, artifacts, usage, research: record };
}
