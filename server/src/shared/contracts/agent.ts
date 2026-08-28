/**
 * Agent contracts (v2 foundation).
 *
 * No agents exist yet and none are built here. What exists is the shape a
 * v2 agent must fit, written now so the pipeline can be migrated one stage
 * at a time instead of all at once.
 *
 * The migration this enables, concretely: `Requirement Analysis` is today a
 * function that takes a prompt and returns a `RequirementSpec`. An agent is
 * the same function with three things added — a declared context need, a
 * token budget, and a validated output artifact. A stage becomes an agent
 * by satisfying this interface; the pipeline keeps calling stages either
 * way. That is why `AgentDefinition` names its inputs and outputs as
 * artifact *types* rather than TypeScript types: the pipeline can then
 * check whether a stage's inputs are available without knowing what the
 * agent does.
 */
import type { AgentContext } from './agent-context.js';
import type { ArtifactType } from './artifact.js';
import type { GraphNodeType } from './engineering-graph.js';
import type { TaskType } from './task.js';

export type AgentId =
  /* ── Planning mesh ────────────────────────────────────────────────── */
  | 'requirement-analyst'
  | 'product-architect'
  | 'architecture-agent'
  | 'database-architect'
  | 'api-architect'
  /* ── Generation mesh ──────────────────────────────────────────────── */
  | 'backend-engineer'
  | 'frontend-engineer'
  | 'ux-ui-engineer'
  /* ── Review mesh ──────────────────────────────────────────────────── */
  | 'security-engineer'
  | 'dependency-engineer'
  | 'code-quality-engineer'
  /* ── Validation mesh ──────────────────────────────────────────────── */
  | 'runtime-engineer'
  | 'integration-engineer'
  | 'test-engineer'
  /* ── Repair ───────────────────────────────────────────────────────── */
  | 'repair-engineer'
  /* ── Declared for later phases ────────────────────────────────────── */
  | 'dependency-analyst'
  | 'reviewer';

export type AgentStatus = 'idle' | 'running' | 'succeeded' | 'failed';

/**
 * How an agent does its work.
 *
 * `deterministic` agents are code — same input, same output, no model, no
 * token cost. `ai` agents reason with a model and therefore need context,
 * a budget, and validation of what comes back. The orchestrator schedules
 * both identically; only the executor cares about the difference.
 */
export type AgentExecutionMode = 'ai' | 'deterministic';

export type AgentPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/**
 * When to try again, and when not to.
 *
 * Retrying a transient provider error is worth the latency; retrying
 * invalid input just burns the same failure twice. `retryableKinds` names
 * the failures worth a second attempt — everything else fails once and
 * stops.
 */
export interface RetryPolicy {
  maxRetries: number;
  /** Base delay; the executor backs off exponentially from here. */
  backoffMs: number;
  retryableKinds: AgentFailureKind[];
}

/**
 * Why an agent failed. Drives the retry decision, so the distinction has
 * to be made at the point of failure rather than guessed from a message.
 */
export type AgentFailureKind =
  | 'provider-error'
  | 'timeout'
  | 'network'
  | 'rate-limit'
  | 'invalid-output'
  | 'invalid-input'
  | 'unauthorized'
  | 'validation-failed'
  | 'cancelled'
  | 'internal';

/**
 * Static declaration of an agent. Data, not behaviour — safe to list in an
 * API, and the only thing the orchestrator reads when planning a run.
 *
 * Dependencies are declared twice on purpose, at two different levels.
 * `requires` names *artifact types*, which is what makes a task READY or
 * BLOCKED regardless of who produced them. `dependencies` names *agents*,
 * which is what builds the execution DAG. An agent can therefore be
 * swapped for another producing the same artifact without any consumer
 * changing.
 */
export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  /** Bumped when the agent's behaviour changes in a way that invalidates prior output. */
  version: string;
  /** Artifact types this agent needs before it can run. */
  requires: ArtifactType[];
  /** Artifact types this agent authors. Exactly one agent authors each. */
  produces: ArtifactType[];
  /**
   * Artifact types this agent rewrites in place rather than authors.
   *
   * The UX engineer is the reason this exists: it edits the frontend the
   * frontend engineer wrote. Folding that into `produces` would claim two
   * authors for one artifact and lose the distinction between creating
   * something and revising it — while leaving it undeclared would mean the
   * executor rejecting the agent's own output as out of scope. Declaring
   * it says exactly what is true: this agent may change that artifact, and
   * someone else made it.
   */
  revises?: ArtifactType[];
  /** Agents that must complete first. Edges of the execution DAG. */
  dependencies: AgentId[];
  /** The Context Engine task this agent's context is compiled for. */
  requiredContext: TaskType | null;
  executionMode: AgentExecutionMode;
  /** Hard ceiling on one attempt, in milliseconds. */
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  /**
   * Graph node types this agent may create or update. The orchestrator does
   * not police individual writes, but recording the boundary is what makes
   * an out-of-scope mutation reviewable rather than invisible.
   */
  mutates: GraphNodeType[];
  enabled: boolean;
}

export type FindingType =
  | 'SECURITY'
  | 'DEPENDENCY'
  | 'CODE_QUALITY'
  | 'UX'
  /** The parts do not fit together: contract, auth, database. */
  | 'INTEGRATION'
  /** The project does not build, start, or stay up. */
  | 'RUNTIME'
  /** An executed test did not pass. */
  | 'TEST_FAILURE'
  | 'GENERAL';

/**
 * How a finding is being handled.
 *
 * Two vocabularies share this union and the boundary between them is
 * enforced in the store. `ACKNOWLEDGED`, `RESOLVED` and `FALSE_POSITIVE`
 * are a person's judgement — an agent only ever emits OPEN, and the repair
 * engine refuses to touch a finding a person has ruled on. The repair
 * states below are the machine's, and each one is earned by evidence:
 * `FIXED` requires a validation pass, `REGRESSION` a rollback that
 * happened, `REPAIR_LOOP` a fix that provably came back.
 */
export type FindingStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'FALSE_POSITIVE'
  /* ── Repair lifecycle ─────────────────────────────────────────────── */
  | 'IN_REPAIR'
  | 'FIXED'
  | 'REJECTED'
  | 'REQUIRES_REVIEW'
  | 'NOT_REPAIRABLE'
  | 'REGRESSION'
  | 'REPAIR_LOOP';

/**
 * Something an agent noticed that is worth a person's attention but is not
 * a failure. The seam the review/repair system reads.
 *
 * The review mesh added the optional fields below rather than a second
 * finding type. A planning agent's "this module depends on nothing that
 * exists" and a security agent's "this endpoint returns other users' data"
 * are the same kind of object — one names a file and cites evidence, the
 * other does not — and splitting them would have meant two systems to
 * query, deduplicate and display.
 *
 * `confidence` is the field that keeps this honest. A deterministic check
 * that read a file and found `eval(` is certain; a model's reading of an
 * authorization flow is not, and a finding that cannot tell you which it
 * is invites a reader to trust both equally.
 */
export interface AgentFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  title: string;
  description: string;
  /** The graph node this concerns, when it concerns one. */
  targetNodeId: string | null;
  status: FindingStatus;
  /** What kind of problem this is. Absent on findings predating the review mesh. */
  type?: FindingType;
  /** The project-relative file the finding was observed in. */
  targetFile?: string | null;
  /**
   * What was actually seen — a line, a fragment, a count. Secrets are
   * redacted before they reach this field; a finding must never be the
   * thing that leaks the credential it is reporting.
   */
  evidence?: string | null;
  recommendation?: string | null;
  /** 0–1. Deterministic observations sit at 1; a model's judgement does not. */
  confidence?: number;
}

export interface AgentUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Tokens the compiled context occupied — the Context Engine's contribution. */
  contextTokens: number;
}

export interface AgentResult<T = unknown> {
  agentId: AgentId;
  status: AgentStatus;
  output: T | null;
  /** Artifacts this run produced, keyed by type. */
  artifacts: Partial<Record<ArtifactType, unknown>>;
  findings: AgentFinding[];
  /** User-facing failure text. Never a stack trace. */
  error: string | null;
  failureKind: AgentFailureKind | null;
  durationMs: number;
  /** Populated when the agent used a model; null for deterministic agents. */
  usage: AgentUsage | null;
}

/**
 * The compiled context an agent receives.
 *
 * Structurally what the Context Engine's `CompiledContext` is, declared
 * here as its own shape so the contracts stay free of a dependency on the
 * engine. The engine satisfies it; a future replacement would too.
 */
export interface AgentContextPayload {
  /** The text the model will actually be sent. */
  text: string;
  tokens: number;
  taskType: TaskType;
  budget: {
    maxContextTokens: number;
    usedContextTokens: number;
    /** Separate from the input ceiling, and never conflated with it. */
    maxOutputTokens: number;
  };
}

/** Everything one execution attempt is given. */
export interface AgentExecutionInput {
  projectId: string;
  runId: string;
  taskId: string;
  /** The original user prompt, for agents that work from it directly. */
  prompt: string;
  /** Artifacts produced by upstream agents, keyed by type. */
  inputArtifacts: Partial<Record<ArtifactType, unknown>>;
  /** Compiled by the Context Engine. Null for agents that need none. */
  context: AgentContextPayload | null;
  /** Resolves when the run is cancelled, so a long agent can stop early. */
  signal: AbortSignal;
}

/**
 * What every agent implements. `execute` receives a context that was
 * already narrowed for it — an agent never selects its own context, which
 * is what keeps context policy in one place rather than nine.
 */
export interface Agent<TOutput = unknown> {
  readonly definition: AgentDefinition;
  execute(input: AgentExecutionInput): Promise<AgentResult<TOutput>>;
}

export type { AgentContext };
