/**
 * Turns a set of agents into an execution plan.
 *
 * The plan is a DAG, not a chain. Agents declare which agents they depend
 * on, and the planner derives waves from that — every task in a wave has
 * its dependencies satisfied by earlier waves. A linear pipeline is simply
 * a DAG where every wave holds one task, so the current three-agent chain
 * and a future fan-out use the same code.
 *
 * Waves are what *could* run concurrently. Whether they actually do is the
 * scheduler's decision, and it currently says no — see `scheduler.ts`.
 */
import { randomUUID } from 'node:crypto';

import { getAgentDefinition } from '../../../shared/contracts/index.js';
import type { AgentId, AgentPriority } from '../../../shared/contracts/index.js';
import type { AgentTask, ExecutionPlan } from '../agent-orchestrator.types.js';

export interface PlanInput {
  projectId: string;
  runId: string;
  agentIds: AgentId[];
  priority: AgentPriority;
}

/**
 * Builds the plan.
 *
 * Dependencies on agents outside the requested set are ignored rather than
 * failing: a caller asking for a subset is asking to run that subset, and
 * the artifact-level READY check is what actually stops a task whose
 * inputs are genuinely missing.
 */
export function buildPlan(input: PlanInput): ExecutionPlan {
  const requested = new Set(input.agentIds);
  const taskIdByAgent = new Map<AgentId, string>();

  const tasks: AgentTask[] = input.agentIds.map((agentId) => {
    const id = randomUUID();
    taskIdByAgent.set(agentId, id);
    return {
      id,
      projectId: input.projectId,
      runId: input.runId,
      agentId,
      status: 'PENDING',
      priority: input.priority,
      inputArtifactTypes: getAgentDefinition(agentId)?.requires ?? [],
      dependencyTaskIds: [],
      startedAt: null,
      completedAt: null,
      durationMs: null,
      error: null,
      failureKind: null,
      retryCount: 0,
      summary: null,
      artifactIds: [],
      usage: null,
      findings: [],
    };
  });

  for (const task of tasks) {
    const definition = getAgentDefinition(task.agentId);
    task.dependencyTaskIds = (definition?.dependencies ?? [])
      .filter((dependency) => requested.has(dependency))
      .map((dependency) => taskIdByAgent.get(dependency))
      .filter((id): id is string => Boolean(id));
  }

  return { tasks, waves: computeWaves(tasks) };
}

/**
 * Groups tasks into dependency waves.
 *
 * Kahn's algorithm: repeatedly take everything whose dependencies are
 * already placed. A cycle leaves tasks unplaceable, which is detected and
 * reported rather than silently dropped — a task missing from the plan
 * would look like a run that simply skipped a stage.
 */
export function computeWaves(tasks: AgentTask[]): string[][] {
  const remaining = new Map(tasks.map((task) => [task.id, new Set(task.dependencyTaskIds)]));
  const placed = new Set<string>();
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining.entries()]
      .filter(([, dependencies]) => [...dependencies].every((id) => placed.has(id)))
      .map(([id]) => id);

    if (wave.length === 0) {
      throw new Error('Cyclic task dependency: the execution plan cannot be ordered');
    }
    for (const id of wave) {
      remaining.delete(id);
      placed.add(id);
    }
    waves.push(wave);
  }

  return waves;
}

/**
 * Priority-ordered scheduling within a wave.
 *
 * Priority never reorders across waves, because that would violate a
 * dependency — a CRITICAL task still waits for the NORMAL task that
 * produces its input.
 */
const PRIORITY_ORDER: Record<AgentPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export function orderByPriority(tasks: AgentTask[]): AgentTask[] {
  return [...tasks].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
