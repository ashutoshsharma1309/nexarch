/**
 * Contracts for the end-to-end generation pipeline.
 *
 * A run is the whole product in one object: the prompt that started it, one
 * `PipelineStage` per stage with its real state, and — once it finishes —
 * the artifacts every stage produced. Progress is stage state, never a
 * synthetic percentage: a client renders exactly what the server has
 * actually done.
 */
import type { AgentId } from '../../shared/contracts/agent.js';
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DesignBundle } from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { GeneratedProject } from '../backend-generator/backend-generator.types.js';
import type { DependencyGraphBundle } from '../dependency-graph/dependency-graph.types.js';
import type { GeneratedFrontend } from '../frontend-generator/frontend-generator.types.js';
import type { SecurityBundle } from '../security-engine/security-engine.types.js';

export type StageId =
  | 'analysis'
  | 'architecture'
  | 'database'
  | 'backend'
  | 'frontend'
  | 'security'
  | 'dependencies'
  | 'graph';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineStage {
  id: StageId;
  label: string;
  status: StageStatus;
  /** Which engine actually did the work — so "real AI" is visible, not claimed. */
  engine: 'ai' | 'deterministic';
  /** The agent that will own this stage in v2. Declarative only — nothing dispatches on it yet. */
  agentId: AgentId;
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
}

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
  /** The runnable file set: generator output overlaid with the hardened security files. */
  files: { path: string; content: string }[];
}

export interface StartRunInput {
  prompt: string;
  /** Names the project the run should join; derived from the prompt when absent. */
  projectName?: string | undefined;
  /** Resolved by the caller, which is the layer that knows who is asking. */
  projectId?: string | undefined;
}

/** Lifecycle phases the generation engine announces. See `pipeline.service.ts`. */
export type RunPhase = 'started' | 'settled';
