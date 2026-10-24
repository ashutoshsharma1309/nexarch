/**
 * Editing an existing generated project from an instruction and, optionally,
 * a reference image.
 *
 * The problem this solves is the one every "AI edits your app" feature gets
 * wrong: asked to change the hero, it regenerates the whole application and
 * the menu, the navigation and the working routes quietly become something
 * else. So nothing here regenerates anything from the prompt. The edit is
 * expressed as a new `SiteDesign` — the same validated object a build
 * produces — and then the *existing* generators are re-run over the
 * *existing* architecture, database design and API contract. Because those
 * generators are deterministic, every file whose inputs did not change comes
 * out byte-identical, and the files that differ are exactly the ones the edit
 * touched. The diff is not a claim about what changed; it is what changed.
 *
 * Three honesty rules shape the rest:
 *
 * - A plan is produced before anything is applied, and it names the files it
 *   expects to change. The result names the files that actually changed.
 * - The edited application is really built, typechecked, linted and started
 *   before the edit is accepted. If it does not come up, the edit is
 *   discarded and the project keeps the files it had — there is nothing to
 *   roll back, because nothing was written until it passed.
 * - Impact comes from the Knowledge Graph's own edges. When the graph has
 *   nothing for a file, the plan says so rather than inventing a dependency.
 */
import { randomUUID } from 'node:crypto';

import { generate } from '../ai-orchestrator/ai-orchestrator.service.js';
import { diffLines } from '../agent-orchestrator/lib/line-diff.js';
import { validateRuntime } from '../agent-orchestrator/lib/runtime-validation.js';
import { stopSession } from '../runner/runner.service.js';
import {
  generateFrontend,
  normalizeSiteDesign,
} from '../frontend-generator/frontend-generator.service.js';
import { auditDomainRelevance } from '../pipeline/lib/domain-relevance.js';
import { loadArtifacts, overlayFiles, registerEditedRun } from '../pipeline/pipeline.service.js';
import { listRunsForProject } from '../pipeline/lib/run-store.js';
import { synchronize as synchronizeGraph } from '../engineering-graph/index.js';
import { getGraph, getImpact } from '../engineering-graph/engineering-graph.service.js';
import { canonicalizePath } from '../engineering-graph/lib/canonical.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import { AppError } from '../../shared/utils/app-error.js';
import { logger } from '../../shared/logger/index.js';
import { redactString } from '../../shared/security/redact.js';
import type { PipelineArtifacts, PipelineStage } from '../pipeline/pipeline.types.js';
import type { SiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { AcceptedImage } from './lib/image-input.js';
import {
  ActiveEditExists,
  activeJobFor,
  advanceStage,
  createJob,
  finishJob,
  getJob,
  heartbeat,
  latestJobFor,
} from './lib/edit-job-store.js';
import type { EditJob, EditStage } from './lib/edit-job-store.js';
import type {
  ChangedFile,
  EditImpact,
  EditPlan,
  EditResult,
  EditValidation,
  ImpactedByEdit,
  PlanEditInput,
  PlannedChange,
  PreservedArea,
  VisualReading,
} from './project-editor.types.js';

/** Plans are short-lived working state, like a pipeline run's artifacts. */
const MAX_PLANS = 40;
const plans = new Map<string, { plan: EditPlan; ownerId: string; artifacts: PipelineArtifacts }>();

function remember(plan: EditPlan, ownerId: string, artifacts: PipelineArtifacts): void {
  plans.set(plan.id, { plan, ownerId, artifacts });
  while (plans.size > MAX_PLANS) {
    const oldest = plans.keys().next().value;
    if (oldest === undefined) break;
    plans.delete(oldest);
  }
}

function planOrThrow(planId: string, ownerId: string) {
  const entry = plans.get(planId);
  // Not-yours and not-found are the same answer, as everywhere else here.
  if (entry?.ownerId !== ownerId) {
    throw AppError.notFound(
      'That edit plan is no longer available. Plans are held in memory, so a server restart clears them — plan the edit again.',
    );
  }
  return entry;
}

/**
 * The project's current state: its newest completed run, with its artifacts.
 *
 * Both halves have to be there. A project whose run row survived a restart
 * but whose artifacts did not cannot be edited, and saying so is better than
 * editing something reconstructed from guesses.
 */
async function baselineOf(
  projectId: string,
): Promise<{ runId: string; artifacts: PipelineArtifacts }> {
  const runs = await listRunsForProject(projectId, 20);
  const latest = runs.find((run) => run.status === 'COMPLETED');
  if (!latest) {
    throw AppError.badRequest(
      'This project has no completed build yet, so there is nothing to edit. Build it first.',
    );
  }
  const artifacts = await loadArtifacts(latest.id);
  if (!artifacts) {
    throw AppError.conflict(
      "The latest build's files were not stored, so an edit would have nothing to start from. Rebuild the project, then edit it.",
    );
  }
  return { runId: latest.id, artifacts };
}

const UNREAD: Omit<VisualReading, 'available' | 'unavailableReason' | 'model'> = {
  layout: '',
  palette: [],
  typography: '',
  spacing: '',
  components: [],
  mood: '',
  notes: '',
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function list(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, itemMax))
    .filter((item) => item !== '')
    .slice(0, max);
}

/**
 * Read the reference image with a vision model.
 *
 * Every failure here ends in `available: false` with the reason attached. The
 * edit still goes ahead on the instruction alone — but it will never claim to
 * have looked at a picture it could not read.
 */
async function readImage(image: AcceptedImage, instruction: string): Promise<VisualReading> {
  try {
    const response = await generate({
      promptId: 'edit-vision',
      variables: { INSTRUCTION: instruction, IMAGE_KIND: image.kind },
      complexity: 'vision-analysis',
      schema: 'generic-json',
      images: [{ dataUrl: image.dataUrl, label: `${image.kind} image (${image.name})` }],
    });
    const raw = JSON.parse(response.content) as Record<string, unknown>;
    return {
      available: true,
      unavailableReason: null,
      layout: text(raw.layout, 300),
      palette: list(raw.palette, 6, 9).filter((value) => /^#[0-9a-fA-F]{3,8}$/.test(value)),
      typography: text(raw.typography, 200),
      spacing: text(raw.spacing, 200),
      components: list(raw.components, 8, 40),
      mood: text(raw.mood, 60),
      notes: text(raw.notes, 400),
      model: response.record.model,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('reference image could not be read', { reason });
    return { ...UNREAD, available: false, unavailableReason: reason, model: null };
  }
}

function readingForPrompt(reading: VisualReading): string {
  if (!reading.available) {
    return 'No image was read for this edit. Work from the instruction alone and do not invent visual details.';
  }
  return [
    `Layout: ${reading.layout || 'not stated'}`,
    `Palette: ${reading.palette.join(', ') || 'not stated'}`,
    `Typography: ${reading.typography || 'not stated'}`,
    `Spacing: ${reading.spacing || 'not stated'}`,
    `Components visible: ${reading.components.join(', ') || 'none named'}`,
    `Mood: ${reading.mood || 'not stated'}`,
    reading.notes === '' ? '' : `Notes: ${reading.notes}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** The design the edit proposes, asked for as a change to the current one. */
async function proposeDesign(
  artifacts: PipelineArtifacts,
  instruction: string,
  reading: VisualReading,
): Promise<SiteDesign> {
  const current = artifacts.siteDesign;
  const response = await generate(
    {
      promptId: 'edit-site-design',
      variables: {
        INSTRUCTION: instruction,
        ORIGINAL_REQUEST: artifacts.requirements.goal ?? artifacts.requirements.projectName,
        PROJECT_TYPE: artifacts.requirements.projectType,
        CAPABILITIES: artifacts.requirements.modules.join(', ') || 'none stated',
        // The theme is shown in the shape the answer must use — mode,
        // temperature, corners, font and ONE accent. Sending the derived
        // twelve-colour palette instead invited the model to echo that
        // structure back, and an answer with `palette` but no `accent` is an
        // answer with no colour change at all: the reference's orange was
        // read correctly and then quietly dropped here.
        CURRENT_DESIGN: JSON.stringify(
          {
            brand: current.brand,
            tagline: current.tagline,
            theme: {
              mode: current.theme.mode,
              temperature: current.theme.temperature,
              corners: current.theme.corners,
              fontId: current.theme.fontId,
              accent: current.theme.palette.accent,
            },
            sections: current.sections,
          },
          null,
          1,
        ),
        VISUAL_READING: readingForPrompt(reading),
      },
      complexity: 'large-planning',
      schema: 'generic-json',
    },
    { maxOutputTokens: 6_144 },
  );
  return normalizeSiteDesign(JSON.parse(response.content), current);
}

/**
 * Rebuild the file set with the new design and nothing else changed.
 *
 * The architecture, database design, API contract and backend are handed back
 * to the generators exactly as the baseline run produced them, so the only
 * input that differs is the design — and so the only output that can differ
 * is what the design feeds.
 */
function rebuildFiles(
  artifacts: PipelineArtifacts,
  design: SiteDesign,
): { files: { path: string; content: string }[]; frontend: PipelineArtifacts['frontend'] } {
  const frontend = generateFrontend(
    artifacts.architecture,
    artifacts.requirements,
    artifacts.design.databaseDesign,
    artifacts.design.openapi,
    { modules: artifacts.backend.modules, routes: artifacts.backend.routes },
    artifacts.design.entityMetadata,
    design,
  );
  return {
    frontend,
    files: [
      ...overlayFiles(artifacts.backend.files, artifacts.security.backendFiles, 'backend'),
      ...overlayFiles(frontend.files, artifacts.security.frontendFiles, 'frontend'),
    ],
  };
}

/**
 * The real difference between two file sets, by path.
 *
 * Pure and exported: "which files did this edit change?" is the claim the
 * whole feature rests on, and it should be testable without generating a
 * project to ask it.
 */
export function changedFilesBetween(
  before: readonly { path: string; content: string }[],
  after: readonly { path: string; content: string }[],
): ChangedFile[] {
  const previous = new Map(before.map((file) => [file.path, file.content]));
  const changed: ChangedFile[] = [];
  for (const file of after) {
    const old = previous.get(file.path);
    if (old === file.content) continue;
    const diff = diffLines(old ?? '', file.content);
    changed.push({
      path: file.path,
      addedLines: diff.added,
      removedLines: diff.removed,
      hunks: diff.hunks,
    });
  }
  return changed;
}

/**
 * What the Knowledge Graph says about the files this edit touches.
 *
 * Only edges the graph actually holds. A file with no node — because the
 * graph predates it, or was never synced — contributes nothing, and the
 * report says the graph was unavailable rather than quietly returning an
 * empty impact that reads like "nothing depends on this".
 */
async function impactOf(
  ownerId: string,
  projectId: string,
  changedPaths: readonly string[],
): Promise<EditImpact> {
  const base: EditImpact = {
    direct: [...changedPaths],
    dependents: [],
    tests: [],
    graphUnavailable: false,
    graphUnavailableReason: null,
  };

  let nodes;
  try {
    nodes = (await getGraph(ownerId, projectId)).nodes;
  } catch (error) {
    return {
      ...base,
      graphUnavailable: true,
      graphUnavailableReason: error instanceof Error ? error.message : String(error),
    };
  }

  const byCanonical = new Map(
    nodes.map((node) => [`${node.type}\u0000${node.canonicalName}`, node]),
  );
  const seen = new Set<string>();
  const dependents: ImpactedByEdit[] = [];
  const tests: ImpactedByEdit[] = [];
  let matched = 0;

  for (const path of changedPaths) {
    const key = canonicalizePath(path);
    const node = byCanonical.get(`FILE\u0000${key}`) ?? byCanonical.get(`TEST\u0000${key}`);
    if (!node) continue;
    matched += 1;
    const analysis = await getImpact(ownerId, projectId, node.id, 2);
    for (const entry of analysis.impacted) {
      if (seen.has(entry.node.id)) continue;
      seen.add(entry.node.id);
      const row: ImpactedByEdit = {
        nodeId: entry.node.id,
        name: entry.node.name,
        type: entry.node.type,
        depth: entry.depth,
        via: entry.via,
        reason: entry.reason,
      };
      if (entry.node.type === 'TEST') tests.push(row);
      else dependents.push(row);
    }
  }

  if (matched === 0) {
    return {
      ...base,
      graphUnavailable: true,
      graphUnavailableReason:
        'None of the files this edit changes have a node in the Knowledge Graph yet, so there is no dependency evidence to report. Rebuild the project to map them.',
    };
  }

  return { ...base, dependents, tests };
}

/** Which part of the project a path belongs to, for the preserved summary. */
function areaOf(path: string): string {
  if (path.startsWith('backend/')) return 'Backend (API, services, database access)';
  if (path.startsWith('frontend/src/features/')) return 'Frontend feature pages';
  if (path.startsWith('frontend/src/shared/')) return 'Shared frontend components';
  return 'Project configuration';
}

function preservedAreas(
  files: readonly { path: string }[],
  changed: ReadonlySet<string>,
): PreservedArea[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (changed.has(file.path)) continue;
    const area = areaOf(file.path);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, fileCount]) => ({ label, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

/** A short, readable account of what the new design changes about the old one. Exported for tests. */
export function describeChange(
  before: SiteDesign,
  after: SiteDesign,
): { summary: string; risks: string[] } {
  const parts: string[] = [];
  const risks: string[] = [];

  const beforeKinds = before.sections.map((section) => section.kind);
  const afterKinds = after.sections.map((section) => section.kind);
  const removed = beforeKinds.filter((kind) => !afterKinds.includes(kind));
  const added = afterKinds.filter((kind) => !beforeKinds.includes(kind));

  if (before.theme.mode !== after.theme.mode) {
    parts.push(`theme switches to ${after.theme.mode}`);
  }
  if (before.theme.palette.accent !== after.theme.palette.accent) {
    parts.push(`accent becomes ${after.theme.palette.accent}`);
  }
  if (before.theme.fontId !== after.theme.fontId)
    parts.push(`type changes to ${after.theme.fontId}`);
  if (added.length > 0) parts.push(`adds ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`removes ${removed.join(', ')}`);
  if (beforeKinds.join() !== afterKinds.join() && added.length === 0 && removed.length === 0) {
    parts.push('reorders the sections');
  }
  if (before.brand !== after.brand) parts.push(`renames the site to ${after.brand}`);

  for (const kind of removed) {
    risks.push(
      `The ${kind} section is in the current site and not in the proposed one — applying this removes it.`,
    );
  }

  return {
    summary:
      parts.length === 0
        ? 'Rewrites the page copy; structure and theme stay as they are.'
        : `This edit ${parts.join(', ')}.`,
    risks,
  };
}

export async function planEdit(input: PlanEditInput): Promise<EditPlan> {
  await getProjectOrThrow(input.ownerId, input.projectId);
  const { runId, artifacts } = await baselineOf(input.projectId);

  const reading = input.image
    ? await readImage(input.image, input.instruction)
    : { ...UNREAD, available: false, unavailableReason: 'No image was attached.', model: null };

  const design = await proposeDesign(artifacts, input.instruction, reading);
  const { files } = rebuildFiles(artifacts, design);
  const changed = changedFilesBetween(artifacts.files, files);
  const changedPaths = changed.map((file) => file.path);

  const { summary, risks } = describeChange(artifacts.siteDesign, design);

  // The edit must not cost the project its subject: a cafe that stops
  // mentioning coffee has been replaced, not edited.
  const relevance = auditDomainRelevance(
    artifacts.requirements.goal ?? artifacts.requirements.projectName,
    design,
  );
  for (const check of relevance.checks) {
    if (check.status === 'FAIL') risks.push(`After this edit: ${check.evidence}`);
  }
  if (changed.length === 0) {
    risks.push(
      'This edit produces no file changes — the proposed design matches what is already built.',
    );
  }

  const changes: PlannedChange[] = changed.map((file) => ({
    path: file.path,
    reason: `${String(file.addedLines)} lines added, ${String(file.removedLines)} removed`,
  }));

  const plan: EditPlan = {
    id: randomUUID(),
    projectId: input.projectId,
    basedOnRunId: runId,
    instruction: input.instruction,
    image: input.image
      ? {
          kind: input.image.kind,
          name: input.image.name,
          bytes: input.image.bytes,
          width: input.image.width,
          height: input.image.height,
        }
      : null,
    reading,
    summary,
    changes,
    preserved: preservedAreas(artifacts.files, new Set(changedPaths)),
    impact: await impactOf(input.ownerId, input.projectId, changedPaths),
    risks,
    validationPlan: [
      'Install and build the edited project',
      'Type-check it',
      'Lint it where the project has a lint script',
      'Start it and check it answers',
    ],
    design,
    status: 'planned',
    createdAt: new Date().toISOString(),
  };

  remember(plan, input.ownerId, artifacts);
  return plan;
}

export function getPlan(planId: string, ownerId: string): EditPlan {
  return planOrThrow(planId, ownerId).plan;
}

/**
 * Apply a planned edit: rebuild, validate for real, then accept or discard.
 *
 * Nothing is written anywhere until the edited project has been built,
 * type-checked and started. That ordering is what makes "rollback" trivial
 * and trustworthy — a rejected edit never became the project's state, so
 * there is no history to rewind and no window where the project was broken.
 */
/**
 * How an edit checks itself.
 *
 * Injectable for one reason: the behaviour that matters most here is what
 * happens when validation *fails*, and the real validator only fails when a
 * generated project genuinely does not build. A test that cannot produce that
 * outcome cannot prove the edit is discarded, so the seam exists to let one
 * try.
 */
export interface EditDeps {
  validate: typeof validateRuntime;
  stop: (sessionId: string) => void;
}

const DEFAULT_DEPS: EditDeps = {
  validate: validateRuntime,
  stop: (sessionId) => {
    stopSession(sessionId, INTERNAL_EDIT_OWNER);
  },
};

/**
 * Accept this edit, or keep the project as it was?
 *
 * Pure and exported, because this is the judgement the whole feature turns on
 * and it should be checkable without generating a project, installing it and
 * waiting ninety seconds for a verdict.
 *
 * The rule is deliberately strict in one direction: a check that did not run
 * is not a check that passed, but it is also not a reason to throw away an
 * edit — a generated project with no lint script has nothing to lint. Only a
 * real failure, or an application that would not start, rejects the edit.
 */
export function decideEditOutcome(
  validation: EditValidation,
  changedCount: number,
  totalCount: number,
): { accepted: boolean; outcome: string } {
  const failed = validation.checks.filter((check) => check.status === 'FAIL');
  const skipped = validation.checks.filter((check) => check.status === 'SKIPPED');

  if (failed.length > 0) {
    return {
      accepted: false,
      outcome: `${failed
        .map((check) => check.name)
        .join(
          ' and ',
        )} failed, so the edit was discarded and the project keeps its previous files.`,
    };
  }
  if (!validation.startedUp) {
    return {
      accepted: false,
      outcome:
        'The edited application did not start, so the edit was discarded and the project keeps its previous files.',
    };
  }

  const ran = validation.checks
    .filter((check) => check.status === 'PASS')
    .map((check) => check.name.toLowerCase());
  const note =
    skipped.length === 0
      ? ''
      : ` ${skipped.map((check) => check.name).join(' and ')} did not run, because the generated project has no such script.`;
  return {
    accepted: true,
    outcome: `The edit passed ${ran.join(', ')}, so it was applied: ${String(changedCount)} files changed, ${String(totalCount - changedCount)} untouched.${note}`,
  };
}

/**
 * Run an edit to completion: rebuild, validate for real, accept or discard.
 *
 * `onStage` is how the work reports where it is. It is called at the real
 * boundaries — the only stages that exist — so a progress display shows
 * measured steps rather than an animation of a number.
 */
export async function applyEdit(
  planId: string,
  ownerId: string,
  deps: EditDeps = DEFAULT_DEPS,
  onStage: (stage: EditStage, detail?: string) => Promise<void> = async () => {
    await Promise.resolve();
  },
): Promise<EditResult> {
  const entry = planOrThrow(planId, ownerId);
  const { plan, artifacts } = entry;
  if (plan.status !== 'planned') {
    throw AppError.conflict(`This edit was already ${plan.status}.`);
  }

  await onStage('rebuilding');
  const { files, frontend } = rebuildFiles(artifacts, plan.design);
  const changedFiles = changedFilesBetween(artifacts.files, files);
  await onStage('validating', `${String(changedFiles.length)} files rebuilt`);

  const project = await getProjectOrThrow(ownerId, plan.projectId);
  const runIdForValidation = randomUUID();
  let validation: EditValidation = {
    checks: [],
    startedUp: false,
    frontendUrl: null,
    backendUrl: null,
  };
  let sessionId: string | null = null;

  try {
    const runtime = await deps.validate({
      projectId: plan.projectId,
      runId: runIdForValidation,
      projectName: project.name,
      files,
    });
    sessionId = runtime.sessionId;
    const result = runtime.result;
    // The detail for each check is the command that produced it, so a
    // failure can be read rather than merely believed.
    const detailFor = (area: string, fragment: string): string => {
      const command = result.commands.find(
        (entry) => entry.area === area && entry.command.includes(fragment),
      );
      if (!command) return 'no such script in the generated project';
      return `${command.command} → exit ${String(command.exitCode)}${
        command.outputTail === '' ? '' : ` · ${command.outputTail.split('\n').slice(-2).join(' ')}`
      }`;
    };

    validation = {
      checks: [
        { name: 'Build', status: result.buildStatus, detail: detailFor('frontend', 'build') },
        {
          name: 'Type check',
          status: result.typeCheckStatus,
          detail: detailFor('frontend', 'typecheck'),
        },
        { name: 'Lint', status: result.lintStatus, detail: detailFor('frontend', 'lint') },
        {
          name: 'Startup',
          status: result.startupStatus,
          detail: result.errors.join('; ') || 'the edited application started',
        },
        {
          name: 'Health',
          status: result.healthStatus,
          detail: result.processes.map((proc) => `${proc.kind} ${proc.status}`).join(', '),
        },
      ],
      startedUp: result.startupStatus === 'PASS',
      frontendUrl: runtime.baseUrls.frontend,
      backendUrl: runtime.baseUrls.backend,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    validation = {
      checks: [{ name: 'Validation', status: 'FAIL', detail: reason }],
      startedUp: false,
      frontendUrl: null,
      backendUrl: null,
    };
  } finally {
    // The validation preview has served its purpose; holding a run slot for
    // it would block the user's own preview of the result.
    if (sessionId !== null) {
      try {
        deps.stop(sessionId);
      } catch (error) {
        logger.warn('edit validation session could not be stopped', { sessionId, error });
      }
    }
  }

  await onStage('deciding', 'install, build, type check, lint and startup finished');
  const { accepted, outcome } = decideEditOutcome(validation, changedFiles.length, files.length);

  if (!accepted) {
    plan.status = 'rejected';
    return {
      planId: plan.id,
      projectId: plan.projectId,
      status: 'rejected',
      runId: null,
      changedFiles,
      unchangedFileCount: files.length - changedFiles.length,
      validation,
      outcome,
      rolledBack: true,
      completedAt: new Date().toISOString(),
    };
  }

  // One stage, because one thing ran. Listing the eight generation stages an
  // edit never performed would be inventing evidence.
  const stages: PipelineStage[] = [
    {
      id: 'frontend',
      label: 'Edit applied',
      status: 'completed',
      engine: 'ai',
      agentId: 'frontend-engineer',
      startedAt: plan.createdAt,
      completedAt: new Date().toISOString(),
      durationMs: null,
      summary: `${String(changedFiles.length)} files changed · ${plan.summary}`,
      error: null,
      degraded: false,
    },
  ];

  const { run, persisted } = await registerEditedRun({
    projectId: plan.projectId,
    projectName: project.name,
    ownerId,
    prompt: plan.instruction,
    artifacts: { ...artifacts, siteDesign: plan.design, frontend, files },
    stages,
    ai: {
      calls: 0,
      provider: 'none',
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
  });

  // `persisted` is the discriminant: the false branch is the only one whose
  // `run` is null, so narrowing on it is what makes `run` safe to use below.
  if (!persisted) {
    // The edit built and started, but its files were not stored. Saying
    // "applied" here would be a lie written to disk: a restart would bring
    // back the *previous* build while the job record still listed the
    // changed files. The old synchronous endpoint's version of this lie died
    // with the HTTP response; this one would outlive it.
    // The plan stays `planned`. This failure was the database's, not the
    // user's, and burning the plan would make them pay for the vision and
    // design calls again to retry something that may well work next time.
    throw AppError.internal(
      'The edit built and started, but its files could not be stored, so it was not applied. The project still has the files it had before.',
    );
  }

  // The graph describes the project as it now is, so it is resynchronized
  // against the edited files rather than left pointing at the old ones.
  try {
    await synchronizeGraph(plan.projectId, run.id, {
      ...artifacts,
      siteDesign: plan.design,
      frontend,
      files,
    });
  } catch (error) {
    logger.warn('graph could not be synchronized after an edit', {
      projectId: plan.projectId,
      error,
    });
  }

  plan.status = 'applied';
  return {
    planId: plan.id,
    projectId: plan.projectId,
    status: 'applied',
    runId: run.id,
    changedFiles,
    unchangedFileCount: files.length - changedFiles.length,
    validation,
    outcome,
    rolledBack: false,
    completedAt: new Date().toISOString(),
  };
}

/** The runner owner the edit's own validation session belongs to. */
const INTERNAL_EDIT_OWNER = 'internal:project-editor';

export function resetEditPlansForTests(): void {
  plans.clear();
}

/* ── Edits as background work ─────────────────────────────────────────── */

/**
 * Start an edit and return immediately.
 *
 * The apply itself takes minutes, which is longer than any HTTP request
 * should live: the old synchronous endpoint made the client's timeout a race
 * the user could lose, failing the request while the server went on to apply
 * the edit anyway. Now the request creates a job, the work continues after
 * the response, and the client polls.
 *
 * One active job per project, enforced here rather than by the UI, because a
 * double-click, a retry and a second tab are all the same request to a server
 * — and two applies against one baseline would race, the slower one silently
 * overwriting the faster.
 */
export async function startEditJob(
  planId: string,
  ownerId: string,
  deps: EditDeps = DEFAULT_DEPS,
): Promise<EditJob> {
  const entry = planOrThrow(planId, ownerId);
  const { plan } = entry;
  if (plan.status !== 'planned') {
    throw AppError.conflict(`This edit was already ${plan.status}.`);
  }

  // Asked first so the common case gets the clear answer, but the database
  // is what actually enforces it: between this read and the create, another
  // request can win, and only the unique index sees both.
  const active = await activeJobFor(plan.projectId);
  if (active) {
    throw AppError.conflict(
      'An edit is already running for this project. Wait for it to finish before starting another.',
    );
  }

  let job: EditJob;
  try {
    job = await createJob({
      projectId: plan.projectId,
      ownerId,
      planId: plan.id,
      instruction: plan.instruction,
    });
  } catch (error) {
    if (error instanceof ActiveEditExists) {
      throw AppError.conflict(
        'An edit is already running for this project. Wait for it to finish before starting another.',
      );
    }
    throw error;
  }

  // Deliberately not awaited: the point is that this outlives the request.
  // Every path inside writes a terminal state, so a job cannot be left
  // claiming to run after the work stops.
  void runEditJob(job.id, planId, ownerId, deps);
  return job;
}

/**
 * How much of a diff is worth keeping in the job record.
 *
 * The result is stored as a row and re-sent on every poll, and a diff is
 * unbounded: one added file contributes its entire text. The counts stay
 * exact — they are computed from the real diff — and the hunks are capped so
 * a large edit cannot grow the row without limit or make polling expensive.
 */
/** Often enough that a ten-minute silence means something is actually wrong. */
const HEARTBEAT_MS = 60_000;

const MAX_STORED_FILES = 40;
const MAX_STORED_HUNKS = 30;

function storableResult(result: EditResult): EditResult {
  const changedFiles = result.changedFiles.slice(0, MAX_STORED_FILES).map((file) => ({
    ...file,
    hunks: file.hunks.slice(0, MAX_STORED_HUNKS),
  }));
  // Each check's detail is the tail of a real command's output, and the
  // generated project is configured with a database URL that has a password
  // in it. Only the job's `error` was being redacted; this is stored in the
  // same row and handed to the same screen.
  const validation = {
    ...result.validation,
    checks: result.validation.checks.map((check) => ({
      ...check,
      detail: redactString(check.detail),
    })),
  };
  return { ...result, changedFiles, validation, outcome: redactString(result.outcome) };
}

async function runEditJob(
  jobId: string,
  planId: string,
  ownerId: string,
  deps: EditDeps,
): Promise<void> {
  const startedAt = Date.now();
  let settled = false;
  // The validating stage writes nothing for minutes; without this the row
  // looks abandoned to the staleness check that protects the project.
  const pulse = setInterval(() => {
    void heartbeat(jobId);
  }, HEARTBEAT_MS);
  pulse.unref();

  try {
    const result = await applyEdit(planId, ownerId, deps, async (stage, detail) => {
      await advanceStage(jobId, stage, detail ?? null);
    });

    await finishJob(jobId, {
      status: result.status === 'applied' ? 'SUCCEEDED' : 'REJECTED',
      result: storableResult(result),
      runId: result.runId,
      detail: result.outcome,
    });
    settled = true;
    logger.info('edit job finished', {
      jobId,
      status: result.status,
      changedFiles: result.changedFiles.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    // A throw after the job was already settled must not rewrite a true
    // SUCCEEDED into a false FAILED.
    if (settled) {
      logger.warn('edit job threw after it had already finished', { jobId });
      return;
    }
    // The edit broke rather than being refused. The project is untouched
    // either way — nothing is written until the checks pass — and the
    // message says so rather than leaving the user to guess.
    // Redacted before it is stored: this field is handed straight back to
    // the client, and a provider or Prisma error can carry a key or a
    // connection string in its message. The schema comment promised this;
    // nothing was enforcing it.
    const reason = redactString(error instanceof Error ? error.message : String(error));
    logger.warn('edit job failed', { jobId, reason, durationMs: Date.now() - startedAt });
    await finishJob(jobId, {
      status: 'FAILED',
      error: `${reason} The project was not changed.`,
      detail: 'the edit could not be completed',
    });
  } finally {
    clearInterval(pulse);
  }
}

/** One job, for the client's polling. */
export async function getEditJob(jobId: string, ownerId: string): Promise<EditJob> {
  const job = await getJob(jobId, ownerId);
  if (!job) throw AppError.notFound('That edit job does not exist');
  return job;
}

/**
 * The job a reader should be looking at for this project.
 *
 * This is what makes a page reload survivable: the client does not have to
 * remember a job id, it asks the project what is happening.
 */
export async function currentEditJob(projectId: string, ownerId: string): Promise<EditJob | null> {
  await getProjectOrThrow(ownerId, projectId);
  const active = await activeJobFor(projectId);
  if (active?.ownerId === ownerId) return active;
  return latestJobFor(projectId, ownerId);
}
