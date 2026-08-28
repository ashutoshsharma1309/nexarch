/**
 * Agent context contracts (v2 foundation).
 *
 * The single most important constraint in v2: an agent never receives the
 * whole project. It receives a context that a resolver built for its
 * specific task, inside a token budget.
 *
 * The types below enforce that by construction. `AgentContext` carries
 * artifact *descriptors* and graph *nodes* — not artifact content and not
 * the graph. Content arrives only through `resolved`, which the resolver
 * fills deliberately and the budget bounds. An agent that wants more has to
 * ask the resolver, and the resolver is the one place that can say no.
 *
 * Nothing here calls a model. The existing AI Orchestrator remains the only
 * component that talks to a provider; a resolver's job ends where the
 * prompt begins.
 */
import type { ArtifactDescriptor, ArtifactType } from './artifact.js';
import type { GraphNode } from './engineering-graph.js';

export interface TokenBudget {
  /** Ceiling for the whole context, in tokens. */
  maxTokens: number;
  /** Tokens already committed by content in `resolved`. */
  usedTokens: number;
}

/** What a caller asks for. The resolver decides what that actually means. */
export interface ContextRequest {
  projectId: string;
  runId: string;
  /** What the agent is about to do — the relevance signal. */
  task: string;
  /** Artifact types the agent declared it needs. */
  requires: ArtifactType[];
  /** Optional graph roots to expand from, e.g. the entity being changed. */
  focusNodeIds?: string[];
  maxTokens: number;
}

/**
 * The narrowed result handed to an agent. Descriptors are always present;
 * `resolved` holds only what the resolver judged worth spending budget on,
 * and `omitted` records what it left out — so a thin context is visible as
 * a decision rather than looking like missing data.
 */
export interface AgentContext {
  projectId: string;
  runId: string;
  task: string;
  /** Everything available, described cheaply. */
  relevantArtifacts: ArtifactDescriptor[];
  /** Graph neighbourhood the resolver selected. Filled by the Engineering Graph's query service. */
  relevantGraphNodes: GraphNode[];
  /** Content the resolver chose to include, keyed by artifact type. */
  resolved: Partial<Record<ArtifactType, unknown>>;
  /** Artifact types deliberately excluded, with the reason. */
  omitted: { type: ArtifactType; reason: 'over-budget' | 'not-relevant' | 'unavailable' }[];
  constraints: string[];
  budget: TokenBudget;
}

/**
 * Turns a request into a context. The seam every future optimization lands
 * behind — relevance scoring, compression, caching — without any agent
 * changing.
 */
export interface ContextResolver {
  resolve(request: ContextRequest): Promise<AgentContext>;
}
