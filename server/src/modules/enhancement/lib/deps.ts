/**
 * Everything the enhancement pipeline reaches outside itself for.
 *
 * Injected because the behaviour that matters most only shows up when
 * something goes wrong: a build that fails, a repair that strays outside the
 * plan, a cancel mid-run. A test has to be able to produce those without
 * installing and booting a real project. Type-only imports, so this file costs
 * nothing at runtime; `enhancement.deps.ts` supplies the real implementations.
 */
import type { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import type { validateRuntime } from '../../agent-orchestrator/lib/runtime-validation.js';
import type { repairVerifiedFailures, verifyProject } from '../../build-verification/index.js';
import type { buildContextWithFallback } from '../../context-engine/index.js';
import type { synchronize } from '../../engineering-graph/index.js';
import type {
  publishExecutionEvent,
  recordStageUsage,
} from '../../execution-events/execution-events.service.js';
import type { PipelineArtifacts } from '../../pipeline/pipeline.types.js';
import type { registerEditedRun } from '../../pipeline/pipeline.service.js';
import type {
  ActiveEditExists,
  activeJobFor,
  advanceStage,
  createJob,
  finishJob,
  getJob,
  heartbeat,
  isCancelRequested,
  latestJobFor,
  requestCancel,
} from '../../project-editor/lib/edit-job-store.js';
import type {
  baselineOf,
  impactOf,
  latestCompletedRunId,
} from '../../project-editor/project-editor.service.js';
import type { ResearchArtifact } from '../../web-research/index.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { runFunctionalChecks } from './functional-checks.js';

export interface EnhancementStore {
  activeJobFor: typeof activeJobFor;
  advanceStage: typeof advanceStage;
  createJob: typeof createJob;
  finishJob: typeof finishJob;
  getJob: typeof getJob;
  heartbeat: typeof heartbeat;
  isCancelRequested: typeof isCancelRequested;
  latestJobFor: typeof latestJobFor;
  requestCancel: typeof requestCancel;
  /** The class `createJob` throws when another job holds the project's slot. */
  ActiveEditExists: typeof ActiveEditExists;
}

export interface EnhancementDeps {
  generate: typeof generate;
  research: (input: {
    prompt: string;
    spec: RequirementSpec;
    referenceUrls?: readonly string[] | undefined;
  }) => Promise<ResearchArtifact>;
  formatBrief: (artifact: ResearchArtifact) => string;
  researchConfigured: () => boolean;
  buildContext: typeof buildContextWithFallback;
  impact: typeof impactOf;
  verify: typeof verifyProject;
  repair: typeof repairVerifiedFailures;
  validate: typeof validateRuntime;
  stop: (sessionId: string) => void;
  runChecks: typeof runFunctionalChecks;
  project: (ownerId: string, projectId: string) => Promise<{ name: string }>;
  baseline: typeof baselineOf;
  latestRunId: typeof latestCompletedRunId;
  loadRun: (runId: string) => Promise<PipelineArtifacts | null>;
  registerRun: typeof registerEditedRun;
  syncGraph: typeof synchronize;
  publish: typeof publishExecutionEvent;
  recordUsage: typeof recordStageUsage;
  store: EnhancementStore;
}
