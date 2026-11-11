/**
 * Contracts for the end-to-end generation pipeline.
 *
 * A run is the whole product in one object: the prompt that started it, one
 * `PipelineStage` per stage with its real state, and — once it finishes —
 * the artifacts every stage produced. Progress is stage state, never a
 * synthetic percentage: a client renders exactly what the server has
 * actually done.
 */
import type { VerificationResult } from '../build-verification/build-verification.types.js';
import type { ResearchArtifact } from '../web-research/web-research.types.js';
import type { AgentId } from '../../shared/contracts/agent.js';
import type { SiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DesignBundle } from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { GeneratedProject } from '../backend-generator/backend-generator.types.js';
import type { DependencyGraphBundle } from '../dependency-graph/dependency-graph.types.js';
import type { GeneratedFrontend } from '../frontend-generator/frontend-generator.types.js';
import type { SecurityBundle } from '../security-engine/security-engine.types.js';
import type { DesignIntelligence } from './lib/design-intelligence.js';
import type { FeatureResult } from './lib/feature-implementation.js';
import type { ProductDecision } from './lib/product-decision.js';

export type StageId =
  | 'analysis'
  | 'research'
  | 'decision'
  | 'design-intelligence'
  | 'architecture'
  | 'database'
  | 'backend'
  | 'frontend'
  | 'security'
  | 'feature-implementation'
  | 'dependencies'
  | 'verification'
  | 'repair'
  | 'graph'
  | 'enhancement';

/** The registry has no researcher yet; research is a real stage regardless. */
export type PipelineAgentId =
  AgentId | 'research-analyst' | 'enhancement-engineer' | 'feature-implementer';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineStage {
  id: StageId;
  label: string;
  status: StageStatus;
  /** Which engine actually did the work — so "real AI" is visible, not claimed. */
  engine: 'ai' | 'deterministic';
  /** The agent identity this stage reports under. Nothing dispatches on it. */
  agentId: PipelineAgentId;
  /** What that identity answers for, in one line. Absent on runs recorded by an edit. */
  responsibility?: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** One line of what this stage produced, e.g. "9 entities · 41 columns". */
  summary: string | null;
  /** User-facing failure text. Never a stack trace. */
  error: string | null;
  /** Set when the stage fell back to deterministic output because the model was unavailable. */
  degraded: boolean;
}

export type RunStatus = 'running' | 'completed' | 'failed';

export interface AiUsageSummary {
  calls: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  /** Calls left out of the cost because their model has no price. */
  unpricedCalls?: number;
  /** Calls whose provider reported no token counts. */
  unreportedTokenCalls?: number;
}

/**
 * What a finished run actually delivered, in one word and one sentence.
 *
 * `status` says whether the run has ended; this says whether what it built can
 * be trusted. A run whose verification failed still ends and keeps its files,
 * so `status` is `completed`, and this is what stops that reading as success.
 */
export type RunOutcome =
  'verified' | 'verification-failed' | 'verification-blocked' | 'incomplete' | 'unverified';

export interface PipelineRun {
  id: string;
  /** The project this run belongs to. Null only for a run started outside the API (tests). */
  projectId: string | null;
  projectName: string;
  prompt: string;
  status: RunStatus;
  stages: PipelineStage[];
  ai: AiUsageSummary;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  /** Absent while running and on runs from before outcomes existed. */
  outcome?: RunOutcome;
  /** The outcome in one plain sentence, always set beside `outcome`. */
  outcomeDetail?: string;
}

/** Everything the run produced. Fetched separately — it is far too large to poll. */
export interface PipelineArtifacts {
  runId: string;
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  architectureMarkdown: string;
  design: DesignBundle;
  backend: GeneratedProject;
  frontend: GeneratedFrontend;
  security: SecurityBundle;
  dependencies: DependencyGraphBundle;
  /**
   * The website's design — theme and ordered sections — as the model wrote
   * it. Kept beside the files it produced so an edit has something to modify:
   * recovering it from the emitted CSS and TSX afterwards is guesswork, and a
   * targeted edit cannot be built on a guess.
   */
  siteDesign: SiteDesign;
  /** The runnable file set: generator output overlaid with the hardened security files. */
  files: { path: string; content: string }[];
  /**
   * What web research found for this run. Absent on runs from before research
   * existed and on runs where it did not run; a limited result is still here
   * with its status and limitations, so "not run" and "found little" differ.
   */
  research?: ResearchArtifact;
  /** Stages that really received research evidence. Empty when none did. */
  researchAppliedTo?: ResearchAppliedStage[];
  /** What this product needs and why. Absent on runs from before the decision existed. */
  productDecision?: ProductDecision;
  /** The design system and page specification the site design was given. */
  designIntelligence?: DesignIntelligence;
  /** What really happened when the generated project was executed. */
  verification?: RunVerification;
  /** Which requested capabilities were implemented, and which files did it. */
  featureImplementation?: FeatureResult;
  /** Unsupported claims code took out of the model-written site, each named. */
  removedClaims?: string[];
  /**
   * Set on every version stored after the original build: an edit, an
   * enhancement, a revert. Absent on bundles from before this field existed.
   */
  changedAfterBuild?: boolean;
}

export type ResearchAppliedStage =
  'requirements' | 'entity-fields' | 'site-design' | 'enhancement-plan';

/** Absent means verification never ran, which is different from it failing. */
export interface RunVerification {
  /** The result for the files stored in this bundle. */
  result: VerificationResult;
  repairAttempts: number;
  repaired: boolean;
  limitations: string[];
}

export interface StartRunInput {
  prompt: string;
  /** Names the project the run should join; derived from the prompt when absent. */
  projectName?: string | undefined;
  /** Resolved by the caller, which is the layer that knows who is asking. */
  projectId?: string | undefined;
  /** Sites the user pointed at as design references. Validated at the route. */
  referenceUrls?: string[] | undefined;
}

/** Lifecycle phases the generation engine announces. See `pipeline.service.ts`. */
export type RunPhase = 'started' | 'settled';
