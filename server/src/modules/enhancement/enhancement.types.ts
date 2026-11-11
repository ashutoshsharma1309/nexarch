/**
 * The vocabulary of enhancing a project that already exists.
 *
 * Unlike a plain edit, which re-runs the deterministic generators over a new
 * design, an enhancement changes source files directly from a plan made
 * against those files. Everything here is shaped so the plan and the result
 * can be compared: what it said it would touch, what it really touched, and
 * what really passed.
 */
import type { ResearchArtifact } from '../web-research/index.js';
import type { ChangedFile, EditImpact } from '../project-editor/project-editor.types.js';

/** The kinds of change this pipeline knows how to plan and check. */
export const ENHANCEMENT_KINDS = [
  'research-features',
  'redesign-page',
  'improve-visuals',
  'add-backend',
  'add-database',
  'add-authentication',
  'integrate-api',
  'add-module',
  'improve-performance',
  'fix-bug',
  'improve-mobile',
  'refactor',
  'improve-accessibility',
  'add-tests',
  'general',
] as const;
export type EnhancementKind = (typeof ENHANCEMENT_KINDS)[number];

export type PlannedFileAction = 'create' | 'modify' | 'delete';

export interface PlannedFile {
  path: string;
  action: PlannedFileAction;
  /** Why this file is in the plan. */
  reason: string;
}

/** An environment variable the change introduces. Placeholder only, never a value. */
export interface EnvChange {
  name: string;
  purpose: string;
  example: string;
}

export interface FlowEndpoint {
  method: string;
  path: string;
}

/** A real register, login, protected route and logout flow to drive over HTTP. */
export interface AuthFlowSpec {
  kind: 'auth';
  register: FlowEndpoint;
  login: FlowEndpoint;
  logout: FlowEndpoint;
  protected: FlowEndpoint;
  emailField: string;
  passwordField: string;
  /** Other required register fields, by name. */
  extraRegisterFields: Record<string, string>;
}

/** A real create, read, update and delete round trip to drive over HTTP. */
export interface CrudFlowSpec {
  kind: 'crud';
  resource: string;
  collectionPath: string;
  createBody: Record<string, unknown>;
  updateBody: Record<string, unknown>;
  idField: string;
  /** Set when the resource sits behind sign-in, so the round trip can authenticate first. */
  auth?: AuthFlowSpec;
}

export type FunctionalCheckSpec = AuthFlowSpec | CrudFlowSpec;

export interface FunctionalCheckStep {
  name: string;
  method: string;
  path: string;
  expected: string;
  actualStatus: number | null;
  passed: boolean;
  detail: string | null;
}

export interface FunctionalCheckResult {
  kind: FunctionalCheckSpec['kind'];
  label: string;
  passed: boolean;
  steps: FunctionalCheckStep[];
  limitations: string[];
}

/** What a capability must really touch for it to count as added. */
export interface CoverageArea {
  area: string;
  label: string;
  satisfied: boolean;
  /** The project already had this area and the change left it alone. */
  alreadyPresent?: boolean;
  paths: string[];
}

export type ResearchOutcome = 'not-needed' | 'skipped' | 'ran';

export interface EnhancementResearchInfo {
  outcome: ResearchOutcome;
  /** Why research did or did not run. Always a real reason. */
  reason: string;
  sourceCount: number;
  findingCount: number;
  limitations: string[];
}

/** The plan as the client sees it. Holds the contract's fields plus the working detail. */
export interface EnhancementPlan {
  planId: string;
  projectId: string;
  instruction: string;
  summary: string;
  steps: string[];
  filesLikelyTouched: string[];
  limitations: string[];
  createdAt: string;
  kind: EnhancementKind;
  basedOnRunId: string;
  files: PlannedFile[];
  impact: EditImpact;
  /** True when a person should read this before it runs. */
  substantial: boolean;
  risks: string[];
  envChanges: EnvChange[];
  research: EnhancementResearchInfo;
  coverage: CoverageArea[];
  functionalChecks: FunctionalCheckSpec[];
  validationPlan: string[];
  status: 'planned' | 'applying' | 'applied' | 'rejected' | 'failed' | 'cancelled';
}

/** One model call that really happened, with what the provider reported. */
export interface ModelCallUsage {
  stage: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  cacheHit: boolean;
}

export type EnhancementStatus = 'applied' | 'rejected' | 'failed' | 'cancelled';

/** A verification step, stored in the shape the job result carries. */
export interface StoredVerificationStep {
  id: string;
  status: string;
  command: string | null;
  exitCode: number | null;
  durationMs: number;
  summary: string;
  reason: string | null;
}

export interface EnhancementResult {
  planId: string;
  projectId: string;
  status: EnhancementStatus;
  /** The run this produced, when it was accepted. */
  runId: string | null;
  /** The run it started from; what a revert restores. */
  baseRunId: string;
  kind: EnhancementKind;
  changedFiles: ChangedFile[];
  unchangedFileCount: number;
  /** One readable line: what happened and why. */
  outcome: string;
  /** True when the project keeps the files it had before this started. */
  rolledBack: boolean;
  completedAt: string;
  verification: {
    ran: boolean;
    ok: boolean;
    steps: StoredVerificationStep[];
    failedRoutes: string[];
  };
  repair: {
    attempted: number;
    repaired: boolean;
    restoredUnplannedFiles: string[];
    /** What the first verification found; `verification` holds only the last cycle. */
    initialFailures?: { id: string; status: string; summary: string }[];
    /** Files outside the plan kept because they repaired an existing failure. */
    baselineRepairs?: { path: string; reason: string }[];
  };
  functionalChecks: FunctionalCheckResult[];
  coverage: CoverageArea[];
  /** Files the plan named that were never actually changed. */
  plannedButUnchanged: string[];
  limitations: string[];
  usage: {
    calls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
}

/**
 * Paths an enhancement changed by hand, carried in the run's stored artifacts.
 *
 * A plain edit rebuilds files from the generators, which know nothing about
 * these changes. Without this record the next design edit would silently put
 * the generated originals back. Optional and additive, so older bundles and
 * `SCHEMA_VERSION` are unaffected.
 */
export interface EnhancementOverlay {
  overriddenPaths: string[];
  removedPaths: string[];
}

export interface PlanRecordResearch {
  artifact: ResearchArtifact;
  brief: string;
}
