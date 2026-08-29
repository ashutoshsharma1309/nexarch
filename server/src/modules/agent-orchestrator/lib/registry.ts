/**
 * The runtime agent registry.
 *
 * Declarations live in `shared/contracts/agent-registry.ts` as data;
 * implementations register themselves here at module load. The separation
 * matters: the orchestrator can plan a run over agents that are declared
 * but not yet implemented, which is what lets the pipeline migrate one
 * stage at a time instead of all at once.
 *
 * Nothing in this codebase instantiates an agent directly. Ask the
 * registry.
 */
import { AGENT_DEFINITIONS, getAgentDefinition } from '../../../shared/contracts/index.js';
import { AppError } from '../../../shared/utils/app-error.js';
import type { Agent, AgentDefinition, AgentId } from '../../../shared/contracts/index.js';

const implementations = new Map<AgentId, Agent>();

export function registerAgent(agent: Agent): void {
  const declared = getAgentDefinition(agent.definition.id);
  if (!declared) {
    throw new Error(`Agent "${agent.definition.id}" has no declaration in AGENT_DEFINITIONS`);
  }
  implementations.set(agent.definition.id, agent);
}

export function getAgent(id: AgentId): Agent {
  const agent = implementations.get(id);
  if (!agent) throw AppError.badRequest(`No implementation registered for agent "${id}"`);
  return agent;
}

export function hasAgent(id: AgentId): boolean {
  return implementations.has(id);
}

/** Every declaration, implemented or not. */
export function listDefinitions(): readonly AgentDefinition[] {
  return AGENT_DEFINITIONS;
}

/**
 * Agents that can actually run: declared enabled *and* implemented.
 *
 * Both halves are required. An enabled declaration with no implementation
 * would plan a task that can never execute; an implementation of a
 * disabled agent should stay dormant until its declaration says otherwise.
 */
export function runnableAgents(): AgentDefinition[] {
  return AGENT_DEFINITIONS.filter(
    (definition) => definition.enabled && implementations.has(definition.id),
  );
}

/**
 * Transitive dependencies of an agent, nearest first.
 *
 * Throws on a cycle rather than looping: a cyclic declaration is a
 * programming error that must surface at planning time, not deadlock at
 * execution time.
 */
export function resolveDependencies(id: AgentId): AgentId[] {
  const seen = new Set<AgentId>();
  const order: AgentId[] = [];

  const walk = (current: AgentId, stack: AgentId[]): void => {
    if (stack.includes(current)) {
      throw new Error(`Cyclic agent dependency: ${[...stack, current].join(' → ')}`);
    }
    const definition = getAgentDefinition(current);
    if (!definition) return;
    for (const dependency of definition.dependencies) {
      walk(dependency, [...stack, current]);
      if (!seen.has(dependency)) {
        seen.add(dependency);
        order.push(dependency);
      }
    }
  };

  walk(id, []);
  return order;
}

/** Test seam: the registry is module state, and tests need a clean one. */
export function resetRegistryForTests(): void {
  implementations.clear();
}
