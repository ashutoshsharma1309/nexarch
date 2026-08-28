/**
 * v2 foundation contracts.
 *
 * Types only — no runtime behaviour, no dependencies on any module. They
 * describe the shapes v2 is built from (projects, runs, artifacts, agents,
 * context, graph) so later phases extend an agreed vocabulary instead of
 * inventing one per feature.
 */
export type {
  ArtifactDescriptor,
  ArtifactResolver,
  ArtifactStatus,
  ArtifactType,
} from './artifact.js';
export { AGENT_DEFINITIONS, getAgentDefinition } from './agent-registry.js';
export type {
  Agent,
  AgentDefinition,
  AgentContextPayload,
  AgentExecutionInput,
  AgentExecutionMode,
  AgentFailureKind,
  AgentFinding,
  FindingStatus,
  FindingType,
  AgentId,
  AgentPriority,
  AgentResult,
  AgentStatus,
  AgentUsage,
  RetryPolicy,
} from './agent.js';
export type { TaskType } from './task.js';
export type {
  AgentContext,
  ContextRequest,
  ContextResolver,
  TokenBudget,
} from './agent-context.js';
export { GRAPH_NODE_TYPES, GRAPH_RELATIONSHIPS } from './engineering-graph.js';
export type {
  DraftEdge,
  DraftNode,
  EngineeringGraph,
  GraphDraft,
  GraphEdge,
  GraphIssue,
  GraphNode,
  GraphNodeType,
  GraphPath,
  GraphRelationship,
  GraphStats,
  GraphSyncResult,
  GraphValidationReport,
  ImpactAnalysis,
  ImpactedNode,
  NodeNeighbourhood,
  RelatedNode,
  TraversalDirection,
  TraversalOptions,
} from './engineering-graph.js';
export type { Project, ProjectStatus, Run, RunStatus } from './project.js';
