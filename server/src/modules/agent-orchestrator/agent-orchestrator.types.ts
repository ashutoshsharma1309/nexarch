/**
 * Contracts for the agent runtime.
 *
 * The orchestrator coordinates; agents do specialized work; the Context
 * Engine decides what each agent is told; the graph stores what came out.
 * This file describes the coordination half — tasks, their state machine,
 * the plan they form, and the events they emit.
 *
 * Progress here is always derived from real task state. There is no
 * percentage field anywhere in this module on purpose: a number nobody
 * measures keeps moving while a task is stuck, which is worse than no
 * number at all.
 */
import type {
  AgentFailureKind,
  AgentFinding,
  AgentId,
  AgentPriority,
  AgentUsage,
  ArtifactType,
} from '../../shared/contracts/index.js';

/**
 * A task's lifecycle.
 *
 * `BLOCKED` and `PENDING` are different states with different causes:
 * PENDING means "not yet scheduled", BLOCKED means "its inputs will never
 * arrive because something upstream failed". Collapsing them would hide
 * the reason a run stalled. `SKIPPED` means the product decision ruled the
 * agent out before it started; it counts as neither work done nor failure.
 */
export type TaskStatus =
  'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'SKIPPED';

export interface AgentTask {
  id: string;
  projectId: string;
  runId: string;
  agentId: AgentId;
  status: TaskStatus;
  priority: AgentPriority;
  /** Artifact types this task consumed, resolved at schedule time. */
  inputArtifactTypes: ArtifactType[];
  /** Tasks that must complete first. The DAG's edges. */
  dependencyTaskIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** User-facing failure text. Never a stack trace. */
  error: string | null;
  failureKind: AgentFailureKind | null;
  retryCount: number;
  /** One line of what the task produced, for the run view. */
  summary: string | null;
  /** Artifact record ids this task wrote — the entry point to its lineage. */
  artifactIds: string[];
  usage: AgentUsage | null;
  findings: AgentFinding[];
  /** True when this task's result was served from the agent-result cache. */
  cached?: boolean;
  /** Why the product decision ruled this agent out. Set only on SKIPPED. */
  skipReason?: string;
  /** Each completion criterion, measured against what the agent returned. */
  completion?: CompletionOutcome;
}

export interface CompletionOutcome {
  met: string[];
  unmet: string[];
}

export type AgentRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AgentRun {
  id: string;
  projectId: string;
  ownerId: string;
  prompt: string;
  status: AgentRunStatus;
  /**
   * The caller named these agents, so the product decision does not get to
   * remove any of them: asking for a subset is asking for exactly that subset.
   */
  explicitAgents?: boolean;
  /**
   * The project's newest completed build when this run started. A repair may
   * only replace that same build: anything newer holds work this run never saw.
   * Null when there was none; absent means it could not be read.
   */
  basedOnRunId?: string | null;
  /**
   * The timeline this attempt publishes to. A resume gets its own, because a
   * timeline ends at its terminal event and the earlier attempt already has one.
   */
  executionJobId?: string;
  tasks: AgentTask[];
  /** The task currently executing, if any. */
  currentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  /** Rolled up from every task's usage — no separate accounting. */
  totals: {
    aiCalls: number;
    inputTokens: number;
    outputTokens: number;
    contextTokens: number;
    costUsd: number;
    /** Calls left out of `costUsd` because their model has no price. */
    unpricedCalls?: number;
    /** Agent-result cache accounting for this run (Step 28). */
    cache?: {
      hits: number;
      misses: number;
      /** Tokens the cache hits would have cost, from the cached results' usage. */
      tokensSaved: number;
      aiCallsSaved: number;
    };
  };
}

/** Counts derived from task state, never stored independently. */
export interface RunProgress {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  skipped: number;
  running: number;
  pending: number;
}

/* ── Events ───────────────────────────────────────────────────────────── */

export type AgentEventType =
  | 'AGENT_QUEUED'
  | 'AGENT_STARTED'
  | 'CONTEXT_RESOLVED'
  | 'AI_REQUEST_STARTED'
  | 'AI_REQUEST_COMPLETED'
  | 'ARTIFACT_CREATED'
  | 'GRAPH_UPDATED'
  | 'VALIDATION_STARTED'
  | 'VALIDATION_PASSED'
  | 'VALIDATION_FAILED'
  | 'AGENT_RETRY'
  | 'AGENT_COMPLETED'
  | 'AGENT_FAILED'
  | 'AGENT_CANCELLED'
  /** The product decision ruled this agent out; `detail.reason` says why. */
  | 'AGENT_SKIPPED'
  /** Review findings landed in the finding store. */
  | 'FINDINGS_RECORDED';

export interface AgentEvent {
  seq: number;
  runId: string;
  taskId: string | null;
  agentId: AgentId | null;
  type: AgentEventType;
  at: string;
  /** Structured, never free-form, and never carrying a secret. */
  detail: Record<string, unknown>;
}

/* ── Planning ─────────────────────────────────────────────────────────── */

export interface ExecutionPlan {
  tasks: AgentTask[];
  /**
   * Tasks grouped by dependency depth. Everything in one wave has its
   * dependencies satisfied by earlier waves, so a wave is the unit that
   * *could* run concurrently once that is proven safe.
   */
  waves: string[][];
}

export interface StartRunInput {
  projectId: string;
  prompt: string;
  /** Restrict the plan to these agents; defaults to every enabled agent. */
  agentIds?: AgentId[];
  priority?: AgentPriority;
}
