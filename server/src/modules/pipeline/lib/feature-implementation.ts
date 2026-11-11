/**
 * Turns a generated scaffold into the product the user asked for.
 *
 * The generators emit a correct structure with `NotImplementedError` handlers
 * and placeholder pages wherever a capability has no ready template, so a
 * build could pass every check and still not do what was asked for.
 * This stage finds what is missing, implements it with the same file
 * implementer the enhancement path uses, and then measures the result from
 * the files. A capability counts as delivered only when the files show it.
 *
 * Bounded by passes, files, calls, tokens and time, because a loop over model
 * calls is a loop over the user's money. Running out is recorded, not hidden.
 */
import { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import {
  assembleContext,
  excerptsForPrompt,
  scoreFiles,
} from '../../enhancement/lib/context-retrieval.js';
import { addedDependencies } from '../../enhancement/lib/dependency-changes.js';
import { implementFile } from '../../enhancement/lib/implementer.js';
import { parseModelJson, parsePlan } from '../../enhancement/lib/plan-parser.js';
import type { ParsedPlan } from '../../enhancement/lib/plan-parser.js';
import { modelCaller } from '../../enhancement/lib/usage.js';
import type { ModelCaller } from '../../enhancement/lib/usage.js';
import type {
  EnhancementResearchInfo,
  ModelCallUsage,
  PlannedFile,
} from '../../enhancement/enhancement.types.js';
import {
  inventedClaimsInSource,
  withoutUnbackedServiceClaims,
} from '../../frontend-generator/frontend-generator.service.js';
import type { SiteDesign } from '../../frontend-generator/frontend-generator.service.js';
import type { GeneratedFrontend } from '../../frontend-generator/frontend-generator.types.js';
import type { GeneratedProject } from '../../backend-generator/backend-generator.types.js';
import { logger } from '../../../shared/logger/index.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { AiCallStat } from './ai-stages.js';
import {
  callsService,
  deriveCapabilities,
  evaluateCapabilities,
  findStubs,
  withPlannerCapabilities,
} from './capability-coverage.js';
import type {
  CapabilityCoverage,
  RequestedCapability,
  StubFinding,
} from './capability-coverage.js';
import type { ProductDecision } from './product-decision.js';

const MAX_PASSES = 2;
const MAX_FILES_PER_PASS = 26;
const MAX_MODEL_CALLS = 48;
/** Input and output together, across the whole stage. */
const MAX_TOTAL_TOKENS = 700_000;
const STAGE_DEADLINE_MS = 20 * 60_000;
const MODEL_CALL_TIMEOUT_MS = 4 * 60_000;
const AGENT_ID = 'feature-implementer';
/**
 * The plan prompt has to fit the smallest provider in the failover chain: a
 * whole-project prompt was refused outright by one (413, 8,941 tokens over an
 * 8,000 limit), which left the stage with no plan at all.
 */
const MAX_PLAN_EXCERPT_CHARS = 10_000;
const MAX_EXCERPT_CHARS = 2_500;
const MAX_MANIFEST_CHARS = 7_000;
const MAX_SCHEMA_CHARS = 3_500;
const MAX_PLAN_EVIDENCE_CHARS = 4_000;
const PLAN_RETRY_WAIT_MS = 20_000;
const LOW_VALUE_PATH = /\.test\.|\/test\/|eslint|jest\.config|Dockerfile|vite-env|components\/ui\//;
const CAPABILITY_LINE = /^([CN]\d+)\s*[:.\-–]\s*(.+)$/;
const FILE_TAGS = /^\s*\[([^\]]{1,60})\]/;

export interface FeatureResult {
  /** `not-run` means no model could do the work, which is not the same as nothing to do. */
  status: 'complete' | 'partial' | 'failed' | 'not-run';
  capabilities: CapabilityCoverage[];
  /** Placeholders found in the scaffold, before implementation. */
  stubsFound: StubFinding[];
  stubsRemaining: StubFinding[];
  filesChanged: string[];
  passes: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  budgetExhausted: boolean;
  limitations: string[];
}

export interface FeatureInput {
  prompt: string;
  spec: RequirementSpec;
  decision: ProductDecision;
  files: readonly { path: string; content: string }[];
  /** The research brief. Web-derived, so it stays in the untrusted channel. */
  evidence?: string | undefined;
  /** Whether a real model can answer; decided by the caller. */
  aiAvailable: boolean;
  /** How long to wait before asking again after a failed plan. */
  retryWaitMs?: number;
  callModel?: typeof generate;
  onUsage?: (usage: AiCallStat) => void;
  onProgress?: (message: string, data?: Record<string, unknown>) => void;
}

export interface FeatureOutcome {
  result: FeatureResult;
  files: { path: string; content: string }[];
}

function fileIn(files: ReadonlyMap<string, string>, pattern: RegExp): string | undefined {
  return [...files.keys()].find((path) => pattern.test(path));
}

/** Facts about this project a step cannot see from its one file. Code-derived. */
function projectFacts(files: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  const dependencies = (path: string): string | null => {
    const raw = files.get(path);
    if (raw === undefined) return null;
    try {
      const manifest = JSON.parse(raw) as Record<string, Record<string, string> | undefined>;
      return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).join(', ');
    } catch {
      return null;
    }
  };
  const backendDeps = dependencies('backend/package.json');
  const frontendDeps = dependencies('frontend/package.json');
  if (backendDeps !== null) lines.push(`Backend packages: ${backendDeps}`);
  if (frontendDeps !== null) lines.push(`Frontend packages: ${frontendDeps}`);
  const schema = files.get('backend/prisma/schema.prisma');
  if (schema !== undefined)
    lines.push(`backend/prisma/schema.prisma:\n${schema.slice(0, MAX_SCHEMA_CHARS)}`);
  const router = fileIn(files, /^frontend\/src\/app\/router\.tsx$/);
  if (router !== undefined) {
    lines.push(
      `Frontend routes live in ${router}; add a route there for every new page, as a lazy import of the page component.`,
    );
  }
  const client = fileIn(files, /^frontend\/src\/shared\/services\/api-client\.ts$/);
  if (client !== undefined)
    lines.push(
      `Frontend HTTP goes through ${client}; import it, do not call fetch directly for this app's own API.`,
    );
  if (files.has('backend/src/routes.ts')) {
    lines.push(
      'New backend modules are mounted in backend/src/routes.ts. Every module has controllers, services, repositories, routes, dto and validators folders, in the style of the existing modules.',
    );
  }
  lines.push(
    'Frontend UI primitives are in frontend/src/shared/components/ui. Pages live in frontend/src/features/<name>/.',
  );
  return lines.join('\n\n');
}

function publicRules(researched: boolean, decision: ProductDecision): string {
  return [
    ...(decision.payments.needed
      ? [
          'This build connects no payment provider and must not take money. A checkout records the order and says plainly that no payment was taken.',
        ]
      : []),
    'You are finishing a generated application so that it really is the product the user asked for.',
    'The scaffold has correct structure but stub handlers and placeholder pages. Replace them with real code: handlers that read and write through Prisma, requested fields exactly as the user named them, and pages that call those handlers and are reachable from the site navigation.',
    'A capability is not done until a user can do it end to end: input validation, loading and error states, persistence, and a route to it from the navigation or page that the request implies.',
    'If the product is empty until it has data, add a Prisma seed script that creates clearly sample records, named "Sample ...", and register it in backend/package.json. A real person, address, phone number or real price is never sample data.',
    'If the request names an outside service, the backend must really call it with fetch, handle its errors and surface them. Do not stub it, and do not add keys to code.',
    'Never invent people, testimonials, credentials, addresses, phone numbers or prices anywhere a visitor can see them. Where a fact is needed and the request does not give it, show a clearly marked placeholder.',
    researched
      ? 'Do not add packages. Build charts and other UI with the packages listed below or plain SVG, because this plan used web research and web content must not choose what is installed.'
      : 'Prefer the packages listed below. Add a package only when the work needs one, and declare it in the matching package.json.',
  ].join('\n');
}

function capabilityList(capabilities: readonly RequestedCapability[]): string {
  return capabilities.map((c) => `- ${c.id}: ${c.title}. ${c.detail}`).join('\n');
}

function stubList(stubs: readonly StubFinding[]): string {
  return stubs.length === 0
    ? 'None.'
    : stubs.map((stub) => `- ${stub.path} (${stub.kind})`).join('\n');
}

function requiredCoverage(
  capabilities: readonly RequestedCapability[],
  stubs: readonly StubFinding[],
): string {
  return [
    'Answer `steps` with one entry per capability, written exactly "<id>: <title>".',
    'Begin each planned file\'s `reason` with the ids it delivers, for example "[C1,C3] why".',
    'If the request asks for something this list misses, add it with the next id (N1, N2, ...) and plan it. Add nothing the request does not ask for.',
    '',
    'Capabilities:',
    capabilityList(capabilities),
    '',
    'Placeholders every one of which must be replaced, so each file must appear in `files`:',
    stubList(stubs),
  ].join('\n');
}

export function plannerCapabilities(
  steps: readonly string[],
): { id: string; title: string; detail: string }[] {
  return steps.flatMap((step) => {
    const match = CAPABILITY_LINE.exec(step);
    const id = match?.[1];
    if (id === undefined || !id.startsWith('N') || match?.[2] === undefined) return [];
    const [title = '', detail = ''] = match[2].split(/\s+[-–—|]\s+/, 2);
    return [{ id, title, detail: detail || title }];
  });
}

export function tagsOf(reason: string): string[] {
  const match = FILE_TAGS.exec(reason);
  return match?.[1] === undefined
    ? []
    : match[1].split(/[,\s]+/).filter((tag) => /^[CN]\d+$/.test(tag));
}

/** Files the plan must cover, after the plan's own, without duplicates. */
function withStubFiles(
  planned: readonly PlannedFile[],
  stubs: readonly StubFinding[],
): PlannedFile[] {
  const seen = new Set(planned.map((file) => file.path));
  const extra: PlannedFile[] = stubs
    .filter((stub) => !seen.has(stub.path))
    .map((stub) => ({
      path: stub.path,
      action: 'modify',
      reason: 'Replace this placeholder with a real implementation of what the project requests.',
    }));
  return [...planned, ...extra];
}

function withinDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${what} took longer than the ${String(MODEL_CALL_TIMEOUT_MS / 60_000)} minute limit`,
        ),
      );
    }, MODEL_CALL_TIMEOUT_MS);
  });
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
  });
}

function asStat(usage: ModelCallUsage): AiCallStat {
  return {
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: usage.costUsd ?? 0,
    knownCostUsd: usage.costUsd,
    durationMs: usage.durationMs,
    attempt: 1,
    cacheHit: usage.cacheHit,
  };
}

interface StageState {
  workspace: Map<string, string>;
  capabilities: RequestedCapability[];
  implementedBy: Map<string, string[]>;
  changed: Set<string>;
  usage: { calls: number; input: number; output: number };
  limitations: string[];
  budgetExhausted: boolean;
  deadline: number;
}

function overBudget(state: StageState): boolean {
  const spent = state.usage.input + state.usage.output;
  if (
    state.usage.calls >= MAX_MODEL_CALLS ||
    spent >= MAX_TOTAL_TOKENS ||
    Date.now() >= state.deadline
  ) {
    if (!state.budgetExhausted) {
      state.limitations.push(
        `Feature Implementation stopped at its limit (${String(state.usage.calls)} model calls, ${String(spent)} tokens), so some work may be unfinished.`,
      );
    }
    state.budgetExhausted = true;
    return true;
  }
  return false;
}

function researchInfo(researched: boolean): EnhancementResearchInfo {
  return {
    outcome: researched ? 'ran' : 'not-needed',
    reason: researched ? 'Research evidence informed this build.' : 'No research evidence applied.',
    sourceCount: 0,
    findingCount: 0,
    limitations: [],
  };
}

async function askPlan(
  call: ModelCaller,
  state: StageState,
  input: FeatureInput,
  gapNote: string,
  stubs: readonly StubFinding[],
): Promise<ParsedPlan> {
  const files = [...state.workspace].map(([path, content]) => ({ path, content }));
  const existing = new Set(state.workspace.keys());
  const scored = scoreFiles(files, input.prompt, 'add-module');
  const assembled = assembleContext(files, scored);
  let room = MAX_PLAN_EXCERPT_CHARS;
  const bundle = {
    ...assembled,
    excerpts: assembled.excerpts.flatMap((excerpt) => {
      if (room <= 0) return [];
      const content = excerpt.content.slice(0, Math.min(MAX_EXCERPT_CHARS, room));
      room -= content.length;
      return [{ ...excerpt, content, truncated: content.length < excerpt.content.length }];
    }),
  };
  const manifest = assembled.manifest
    .filter((path) => !LOW_VALUE_PATH.test(path))
    .join('\n')
    .slice(0, MAX_MANIFEST_CHARS);
  const variables: Record<string, string> = {
    INSTRUCTION: `${input.prompt}\n\n${publicRules(input.evidence !== undefined, input.decision)}`,
    KIND: 'complete the requested product',
    PROJECT_SUMMARY: `${input.spec.projectName} (${input.spec.projectType}): ${input.spec.goal ?? 'no stated goal'}`,
    ARCHITECTURE_CONTEXT: projectFacts(state.workspace),
    IMPACT: 'This project was generated moments ago and has never run, so nothing depends on it.',
    MANIFEST: manifest,
    EXCERPTS: excerptsForPrompt(bundle) || 'No file matched the request.',
    REQUIRED_COVERAGE: requiredCoverage(state.capabilities, stubs),
    GAP_NOTE: gapNote,
  };
  const response = await withinDeadline(
    call(
      {
        promptId: 'enhance-plan',
        variables,
        complexity: 'large-planning',
        schema: 'generic-json',
        ...(input.evidence === undefined
          ? {}
          : { untrustedData: input.evidence.slice(0, MAX_PLAN_EVIDENCE_CHARS) }),
      },
      { stage: 'feature-implementation', agentId: AGENT_ID, maxOutputTokens: 8_192 },
    ),
    'Planning the features',
  );
  return parsePlan(parseModelJson(response.content), existing);
}

function isVisitorFacing(path: string): boolean {
  return path.startsWith('frontend/src/') && !/\.(test|spec)\./.test(path);
}

/** One file. Returns the failure message, or null when it was changed. */
async function implementOne(
  file: PlannedFile,
  call: ModelCaller,
  state: StageState,
  input: FeatureInput,
  changedSoFar: string[],
  planText: { summary: string; steps: string[] },
): Promise<string | null> {
  const baseline = state.workspace.get(file.path);
  const facts = projectFacts(state.workspace);
  const instruction = `${input.prompt}\n\n${publicRules(input.evidence !== undefined, input.decision)}\n\n## Project facts\n${facts}`;
  const researched = input.evidence !== undefined;
  let reason = file.reason;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (overBudget(state)) return 'the budget ran out';
    try {
      const done = await withinDeadline(
        implementFile({
          plan: { instruction, ...planText, research: researchInfo(researched) },
          file: { ...file, reason },
          workspace: state.workspace,
          changedSoFar,
          call,
        }),
        file.path,
      );
      if (done.content === null) return 'it was planned for removal';
      const claims = isVisitorFacing(file.path)
        ? inventedClaimsInSource(done.content, baseline, input.prompt)
        : [];
      if (claims.length > 0) {
        if (attempt === 0) {
          reason = `${file.reason} Remove these, which the request never states: ${claims.join('; ')}.`;
          continue;
        }
        return `it kept adding claims the request does not support: ${claims.join('; ')}`;
      }
      state.workspace.set(done.path, done.content);
      state.changed.add(done.path);
      changedSoFar.push(done.path);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1) return message;
      // Free-tier providers limit tokens per minute, and a whole product runs
      // into that; asking again at once would only hit the same limit.
      if (/429|rate limit/i.test(message)) {
        await new Promise((resolve) =>
          setTimeout(resolve, input.retryWaitMs ?? PLAN_RETRY_WAIT_MS),
        );
      }
      reason = `${file.reason} A previous attempt failed: ${message}.`;
    }
  }
  return 'it could not be completed';
}

function gapNoteFor(
  coverage: readonly CapabilityCoverage[],
  stubs: readonly StubFinding[],
  failures: readonly string[],
): string {
  const missing = coverage
    .filter((entry) => entry.status === 'missing')
    .map((entry) => `- ${entry.id} ${entry.title}: ${entry.gaps.join(' ')}`);
  const remaining = stubs.map((stub) => `- ${stub.path} is still a placeholder`);
  const lines = [...missing, ...remaining, ...failures.map((failure) => `- ${failure}`)];
  return [
    '',
    '## Still not done',
    '',
    'A previous pass left the following. Plan only what is needed to finish them:',
    '',
    ...lines,
  ].join('\n');
}

/**
 * The manifests were written from the scaffold, so a stub this stage replaced
 * would still read as unimplemented. Only a flag whose own files held a stub,
 * were changed, and hold none now is raised; anything else stays as it was.
 */
export function reconcileImplementedFlags<
  T extends {
    backend: Pick<GeneratedProject, 'routes' | 'modules' | 'stats'>;
    frontend: Pick<GeneratedFrontend, 'pages'>;
  },
>(artifacts: T, result: Pick<FeatureResult, 'stubsFound' | 'stubsRemaining' | 'filesChanged'>): T {
  const found = new Set(result.stubsFound.map((stub) => stub.path));
  const remaining = new Set(result.stubsRemaining.map((stub) => stub.path));
  const changed = new Set(result.filesChanged);
  const delivered = (prefix: string, files: readonly string[]): boolean => {
    const paths = files.map((file) => `${prefix}/${file}`);
    return (
      paths.some((path) => found.has(path) && changed.has(path)) &&
      !paths.some((path) => remaining.has(path))
    );
  };

  const routes = artifacts.backend.routes.map((route) => {
    if (route.implemented) return route;
    const owner = artifacts.backend.modules.find((mod) =>
      route.handler.startsWith(`${mod.name}Controller.`),
    );
    return owner && delivered('backend', owner.files) ? { ...route, implemented: true } : route;
  });
  const pages = artifacts.frontend.pages.map((page) =>
    !page.implemented && delivered('frontend', page.files) ? { ...page, implemented: true } : page,
  );
  return {
    ...artifacts,
    backend: {
      ...artifacts.backend,
      routes,
      stats: {
        ...artifacts.backend.stats,
        implementedEndpoints: routes.filter((route) => route.implemented).length,
      },
    },
    frontend: { ...artifacts.frontend, pages },
  };
}

/** Removes "powered by X" copy for services the delivered code never calls. */
export function reconcileServiceClaims(
  design: SiteDesign,
  files: readonly { path: string; content: string }[],
): {
  design: SiteDesign;
  files: { path: string; content: string }[];
  removed: string[];
} {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const checked = withoutUnbackedServiceClaims(design, (name) => callsService(name, byPath));
  if (checked.replacements.length === 0) {
    return { design, files: [...files], removed: [] };
  }
  const contentPath = 'frontend/src/content/site.ts';
  let content = byPath.get(contentPath);
  if (content !== undefined) {
    for (const { from, to } of checked.replacements) {
      content = content.split(JSON.stringify(from)).join(JSON.stringify(to));
    }
    byPath.set(contentPath, content);
  }
  return {
    design: checked.design,
    files: files.map((file) => ({
      path: file.path,
      content: byPath.get(file.path) ?? file.content,
    })),
    removed: checked.removed,
  };
}

function finalStatus(
  capabilities: readonly CapabilityCoverage[],
  stubs: readonly StubFinding[],
): FeatureResult['status'] {
  const missing = capabilities.filter((entry) => entry.status === 'missing').length;
  if (missing === 0 && stubs.length === 0) return 'complete';
  return missing < capabilities.length ? 'partial' : 'failed';
}

/** Never throws for an expected failure: the outcome says what happened. */
export async function implementRequestedFeatures(input: FeatureInput): Promise<FeatureOutcome> {
  const workspace = new Map(input.files.map((file) => [file.path, file.content]));
  const stubsFound = findStubs(workspace);
  const state: StageState = {
    workspace,
    capabilities: deriveCapabilities(input.spec, input.decision),
    implementedBy: new Map(),
    changed: new Set(),
    usage: { calls: 0, input: 0, output: 0 },
    limitations: [],
    budgetExhausted: false,
    deadline: Date.now() + STAGE_DEADLINE_MS,
  };
  const emptyResult = (status: FeatureResult['status']): FeatureResult => ({
    status,
    capabilities: state.capabilities.map((capability) => ({
      id: capability.id,
      title: capability.title,
      source: capability.source,
      status: 'missing',
      files: [],
      gaps: ['No model was available to implement it.'],
    })),
    stubsFound,
    stubsRemaining: stubsFound,
    filesChanged: [],
    passes: 0,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    budgetExhausted: false,
    limitations: state.limitations,
  });
  if (!input.aiAvailable) {
    state.limitations.push(
      'No AI provider is configured, so requested features were not implemented; the scaffold is delivered as generated.',
    );
    return {
      result: emptyResult(
        stubsFound.length + state.capabilities.length === 0 ? 'complete' : 'not-run',
      ),
      files: input.files.map((file) => ({ ...file })),
    };
  }

  const call = modelCaller(input.callModel ?? generate, (usage) => {
    state.usage.calls += 1;
    state.usage.input += usage.inputTokens ?? 0;
    state.usage.output += usage.outputTokens ?? 0;
    input.onUsage?.(asStat(usage));
  });

  let stubs = stubsFound;
  let gapNote = '';
  let passes = 0;
  let coverage: CapabilityCoverage[] = [];
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    if (overBudget(state)) break;
    passes = pass;
    let plan: ParsedPlan;
    try {
      plan = await askPlan(call, state, input, gapNote, stubs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn('feature plan failed', { reason });
      state.limitations.push(`The feature plan could not be produced: ${reason}`);
      // A different request, so the retry cannot be answered from the cache.
      gapNote = `\n\nThe previous answer could not be used (${reason}). Answer with the JSON only.`;
      if (pass < MAX_PASSES) {
        // Usually a rate limit, which an immediate second try only hits again.
        await new Promise((resolve) =>
          setTimeout(resolve, input.retryWaitMs ?? PLAN_RETRY_WAIT_MS),
        );
      }
      continue;
    }
    state.limitations.push(...plan.rejected.map((rejected) => `Plan rejected ${rejected}`));
    state.capabilities = withPlannerCapabilities(
      state.capabilities,
      plannerCapabilities(plan.steps),
    );
    const files = withStubFiles(
      plan.files.filter((file) => file.action !== 'delete'),
      stubs,
    ).slice(0, MAX_FILES_PER_PASS);
    if (files.length === 0 && state.capabilities.length === 0) break;
    input.onProgress?.(`Implementing ${String(files.length)} files`, { pass, files: files.length });

    const planText = {
      summary: plan.summary || 'Complete the product the user asked for.',
      steps: plan.steps.length > 0 ? plan.steps : [capabilityList(state.capabilities)],
    };
    const failures: string[] = [];
    const changedSoFar: string[] = [];
    for (const file of files) {
      if (overBudget(state)) break;
      const failure = await implementOne(file, call, state, input, changedSoFar, planText);
      if (failure === null) {
        for (const tag of tagsOf(file.reason)) {
          state.implementedBy.set(tag, [...(state.implementedBy.get(tag) ?? []), file.path]);
        }
      } else {
        failures.push(`${file.path} could not be changed: ${failure}`);
        input.onProgress?.(`Could not change ${file.path}`, { path: file.path });
      }
    }
    stubs = findStubs(state.workspace);
    coverage = evaluateCapabilities({
      capabilities: state.capabilities,
      implementedBy: state.implementedBy,
      files: state.workspace,
      changed: [...state.changed],
      stubs,
    });
    if (coverage.every((entry) => entry.status === 'implemented') && stubs.length === 0) break;
    gapNote = gapNoteFor(coverage, stubs, failures);
    if (pass === MAX_PASSES) state.limitations.push(...failures);
  }
  if (passes === 0 || coverage.length === 0) {
    coverage = evaluateCapabilities({
      capabilities: state.capabilities,
      implementedBy: state.implementedBy,
      files: state.workspace,
      changed: [...state.changed],
      stubs,
    });
  }

  if (input.evidence !== undefined) {
    const added = addedDependencies(input.files, state.workspace);
    if (added.length > 0) {
      for (const file of input.files) {
        if (/(^|\/)package\.json$/.test(file.path)) state.workspace.set(file.path, file.content);
      }
      state.limitations.push(
        `Web research informed this build, so packages it chose were not installed: ${added.slice(0, 10).join(', ')}.`,
      );
    }
  }

  const result: FeatureResult = {
    status: finalStatus(coverage, stubs),
    capabilities: coverage,
    stubsFound,
    stubsRemaining: stubs,
    filesChanged: [...state.changed],
    passes,
    modelCalls: state.usage.calls,
    inputTokens: state.usage.input,
    outputTokens: state.usage.output,
    budgetExhausted: state.budgetExhausted,
    limitations: [...new Set(state.limitations)].slice(0, 30),
  };
  return {
    result,
    files: [...state.workspace].map(([path, content]) => ({ path, content })),
  };
}
