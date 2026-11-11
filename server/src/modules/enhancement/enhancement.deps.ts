/**
 * The real implementations behind `EnhancementDeps`.
 *
 * Kept apart from the pipeline logic so that logic can be loaded and tested
 * without pulling in the pipeline, the runner and a database connection.
 */
import { generate } from '../ai-orchestrator/ai-orchestrator.service.js';
import { validateRuntime } from '../agent-orchestrator/lib/runtime-validation.js';
import { repairVerifiedFailures, verifyProject } from '../build-verification/index.js';
import { buildContextWithFallback } from '../context-engine/index.js';
import { synchronize } from '../engineering-graph/index.js';
import {
  publishExecutionEvent,
  recordStageUsage,
} from '../execution-events/execution-events.service.js';
import { loadArtifacts, registerEditedRun } from '../pipeline/pipeline.service.js';
import {
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
} from '../project-editor/lib/edit-job-store.js';
import {
  baselineOf,
  impactOf,
  latestCompletedRunId,
} from '../project-editor/project-editor.service.js';
import { INTERNAL_RUNNER_OWNER, stopSession } from '../runner/runner.service.js';
import { formatEvidenceBrief, researchProduct } from '../web-research/index.js';
import { getProjectOrThrow } from '../workspace/workspace.service.js';
import { runFunctionalChecks } from './lib/functional-checks.js';
import type { EnhancementDeps } from './lib/deps.js';

/** Well under a build's budget: this runs while someone waits for a plan. */
const RESEARCH_LIMITS = { maxSearches: 4, maxExtractions: 3 };
const BRIEF_CHARS = 6_000;

export const defaultEnhancementDeps: EnhancementDeps = {
  generate,
  research: (input) => researchProduct(input, { limits: RESEARCH_LIMITS }),
  formatBrief: (artifact) => formatEvidenceBrief(artifact, { maxChars: BRIEF_CHARS }),
  researchConfigured: () =>
    ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY'].some(
      (name) => (process.env[name]?.trim() ?? '') !== '',
    ),
  buildContext: buildContextWithFallback,
  impact: impactOf,
  verify: verifyProject,
  repair: repairVerifiedFailures,
  validate: validateRuntime,
  stop: (sessionId) => {
    stopSession(sessionId, INTERNAL_RUNNER_OWNER);
  },
  runChecks: runFunctionalChecks,
  project: getProjectOrThrow,
  baseline: baselineOf,
  latestRunId: latestCompletedRunId,
  loadRun: (runId) => loadArtifacts(runId),
  registerRun: registerEditedRun,
  syncGraph: synchronize,
  publish: publishExecutionEvent,
  recordUsage: recordStageUsage,
  store: {
    activeJobFor,
    advanceStage,
    createJob,
    finishJob,
    getJob,
    heartbeat,
    isCancelRequested,
    latestJobFor,
    requestCancel,
    ActiveEditExists,
  },
};
