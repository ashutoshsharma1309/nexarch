/**
 * Skip a whole agent when its inputs have not changed.
 *
 * The context cache saves a context resolution and the LLM cache saves one
 * model call, but neither saves the *agent*: re-running a project still
 * re-executes every agent's deterministic work, re-resolves its context,
 * and — because each run stamps a fresh graph version into that context —
 * re-calls the model on a cache-missing prompt. The measured result is
 * that a second identical run costs exactly what the first did.
 *
 * This cache is content-addressed, which is the whole design. An agent's
 * identity is a hash of everything that could change its output: the
 * agent's id and version, its prompt's version, the model it routes to,
 * the user prompt it reads, and the *content* of every artifact it
 * consumes — not the artifact's version number, its bytes. Two runs that
 * produce byte-identical upstream artifacts therefore produce identical
 * downstream keys, and the second run's agents are served from cache
 * without executing.
 *
 * Correctness follows from the same property: change the prompt, bump an
 * agent version, edit any input artifact, and its hash changes, the key
 * misses, and the agent re-runs. Step 21's rule — never a stale result
 * after a relevant change — is not a check bolted on afterwards; it is
 * what content-addressing *is*.
 *
 * What is deliberately NOT cached: the validation mesh. The runtime,
 * integration and test engineers execute the live project — they install
 * dependencies, open ports, call a running server — and their result is a
 * fact about *this execution*, not a function of their inputs. Caching
 * "the build passed" would be caching a claim that must be re-earned every
 * time. They are excluded by an allowlist of pure agents.
 */
import { createHash } from 'node:crypto';

import type { AgentDefinition, AgentId } from '../../../shared/contracts/index.js';
import type { AgentResult } from '../../../shared/contracts/index.js';
import { PROMPT_VERSIONS } from './prompt-versions.js';

/**
 * Agents whose output is a pure function of their declared inputs, and so
 * safe to cache. The validation mesh is absent on purpose — see the file
 * header. Repair is absent because it mutates and is driven outside a run.
 */
const CACHEABLE_AGENTS: ReadonlySet<AgentId> = new Set([
  'requirement-analyst',
  'product-architect',
  'architecture-agent',
  'database-architect',
  'api-architect',
  'backend-engineer',
  'frontend-engineer',
  'ux-ui-engineer',
  'security-engineer',
  'dependency-engineer',
  'code-quality-engineer',
]);

export function isCacheableAgent(agentId: AgentId): boolean {
  return CACHEABLE_AGENTS.has(agentId);
}

interface CacheEntry {
  result: AgentResult;
  storedAt: number;
  hits: number;
}

const entries = new Map<string, CacheEntry>();
const byProject = new Map<string, Set<string>>();

const TTL_MS = 60 * 60_000; // an hour; content-addressing makes staleness impossible, TTL only bounds memory
const MAX_ENTRIES = 400;

let hits = 0;
let misses = 0;

/** The model routing signature — which models this agent would call. */
function modelSignature(): string {
  return `${process.env.AI_PROVIDER ?? 'groq'}:${process.env.AI_MODEL_FAST ?? 'fast'}:${process.env.AI_MODEL_DEEP ?? 'deep'}`;
}

/** A stable hash of one artifact's content, order-independent for objects. */
function hashContent(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 24);
}

/** JSON with sorted keys, so `{a,b}` and `{b,a}` hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export interface CacheKeyInput {
  projectId: string;
  definition: AgentDefinition;
  prompt: string;
  /** The input artifacts the agent will read, keyed by type. */
  inputArtifacts: Partial<Record<string, unknown>>;
}

/**
 * The content address of an agent execution.
 *
 * Only the artifacts the agent *declares* it requires enter the key — a
 * change to an unrelated artifact must not invalidate an agent that never
 * reads it, or the cache would never hit on an incremental change.
 */
export function agentCacheKey(input: CacheKeyInput): string {
  const { definition } = input;
  const inputHashes = definition.requires
    .map((type) => `${type}:${hashContent(input.inputArtifacts[type])}`)
    .sort();

  const shape = JSON.stringify({
    project: input.projectId,
    agent: definition.id,
    agentVersion: definition.version,
    promptVersion: definition.requiredContext ? (PROMPT_VERSIONS[definition.id] ?? 'none') : 'none',
    model: definition.executionMode === 'ai' ? modelSignature() : 'deterministic',
    // The prompt only matters to agents with no artifact inputs (the
    // requirement analyst reads it); including it always is harmless and
    // correct.
    prompt: definition.requires.length === 0 ? hashContent(input.prompt) : 'n/a',
    inputs: inputHashes,
  });
  return createHash('sha256').update(shape).digest('hex').slice(0, 32);
}

export function readAgentResult(key: string): AgentResult | null {
  const entry = entries.get(key);
  if (!entry) {
    misses += 1;
    return null;
  }
  if (Date.now() - entry.storedAt > TTL_MS) {
    entries.delete(key);
    misses += 1;
    return null;
  }
  entry.hits += 1;
  hits += 1;
  return entry.result;
}

export function writeAgentResult(projectId: string, key: string, result: AgentResult): void {
  entries.set(key, { result, storedAt: Date.now(), hits: 0 });
  const forProject = byProject.get(projectId) ?? new Set<string>();
  forProject.add(key);
  byProject.set(projectId, forProject);

  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Drops a project's cached results — for an explicit "run fresh" request. */
export function invalidateProjectResults(projectId: string): number {
  const keys = byProject.get(projectId);
  if (!keys) return 0;
  for (const key of keys) entries.delete(key);
  byProject.delete(projectId);
  return keys.size;
}

export function cacheStats(): { hits: number; misses: number; size: number } {
  return { hits, misses, size: entries.size };
}

export function resetAgentResultCacheForTests(): void {
  entries.clear();
  byProject.clear();
  hits = 0;
  misses = 0;
}
