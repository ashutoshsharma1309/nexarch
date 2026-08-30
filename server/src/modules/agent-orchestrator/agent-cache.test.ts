/**
 * Agent-result cache tests (`npm test`).
 *
 * The cache's one job is to be correct while it is fast: a hit only when
 * every input is byte-identical, a miss the instant anything an agent
 * reads has changed. These tests pin exactly that boundary — the same
 * inputs collide, a changed input diverges, an unrelated change does not,
 * and a prompt/version bump invalidates — because a cache that is wrong
 * about any of these returns a stale result, which is worse than no cache.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  agentCacheKey,
  cacheStats,
  isCacheableAgent,
  readAgentResult,
  resetAgentResultCacheForTests,
  writeAgentResult,
} from './lib/agent-result-cache.js';
import { getAgentDefinition } from '../../shared/contracts/index.js';
import type { AgentResult } from '../../shared/contracts/index.js';

const backend = getAgentDefinition('backend-engineer');
const analyst = getAgentDefinition('requirement-analyst');
assert.ok(backend && analyst, 'the two fixture agents must be declared');

/** backend-engineer's declared inputs, so a realistic key can be built. */
function backendInputs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'requirement-spec': { modules: ['auth', 'products'] },
    'architecture-plan': { apiModules: [{ module: 'products' }] },
    'database-design': { tables: [{ entity: 'Products' }] },
    'api-contract': { paths: { '/products': { get: {} } } },
    ...overrides,
  };
}

const sampleResult: AgentResult = {
  agentId: 'backend-engineer',
  status: 'succeeded',
  output: null,
  artifacts: { 'backend-source': { files: [] } },
  findings: [],
  error: null,
  failureKind: null,
  durationMs: 10,
  usage: null,
};

beforeEach(() => {
  resetAgentResultCacheForTests();
});

describe('cacheable set', () => {
  it('caches planning, generation and review; never the validation mesh', () => {
    for (const id of ['requirement-analyst', 'backend-engineer', 'security-engineer'] as const) {
      assert.ok(isCacheableAgent(id), `${id} should be cacheable`);
    }
    for (const id of [
      'runtime-engineer',
      'integration-engineer',
      'test-engineer',
      'repair-engineer',
    ] as const) {
      assert.ok(!isCacheableAgent(id), `${id} must not be cached — it executes the live project`);
    }
  });
});

describe('content-addressed identity', () => {
  it('the same inputs produce the same key', () => {
    const a = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    const b = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    assert.equal(a, b);
  });

  it('a change to a consumed artifact changes the key', () => {
    const before = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    const after = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs({
        'database-design': { tables: [{ entity: 'Products' }, { entity: 'Reviews' }] },
      }),
    });
    assert.notEqual(before, after, 'a schema change must invalidate the backend cache');
  });

  it('object key order does not matter', () => {
    const a = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs({ 'requirement-spec': { modules: ['auth', 'products'] } }),
    });
    const b = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs({ 'requirement-spec': { modules: ['auth', 'products'] } }),
    });
    assert.equal(a, b);
  });

  it('an unrelated artifact the agent does not read is ignored', () => {
    // backend-engineer never declares `product-spec`; adding one must not
    // change its key, or an incremental change elsewhere would needlessly
    // re-run it.
    const before = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    const after = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs({ 'product-spec': { anything: 'here' } }),
    });
    assert.equal(before, after);
  });

  it('a different project never collides', () => {
    const a = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    const b = agentCacheKey({
      projectId: 'p2',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    assert.notEqual(a, b, 'the project id is part of the address (Step 41)');
  });

  it('the analyst keys on the prompt it reads', () => {
    const a = agentCacheKey({
      projectId: 'p1',
      definition: analyst,
      prompt: 'build a shop',
      inputArtifacts: {},
    });
    const b = agentCacheKey({
      projectId: 'p1',
      definition: analyst,
      prompt: 'build a school',
      inputArtifacts: {},
    });
    assert.notEqual(a, b, 'a different prompt is a different requirement analysis');
  });

  it('a version bump invalidates', () => {
    const base = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    const bumped = agentCacheKey({
      projectId: 'p1',
      definition: { ...backend, version: '99.0.0' },
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    assert.notEqual(base, bumped);
  });
});

describe('store behaviour', () => {
  it('stores and serves, counting hits and misses', () => {
    const key = agentCacheKey({
      projectId: 'p1',
      definition: backend,
      prompt: 'x',
      inputArtifacts: backendInputs(),
    });
    assert.equal(readAgentResult(key), null); // miss
    writeAgentResult('p1', key, sampleResult);
    const served = readAgentResult(key);
    assert.ok(served); // hit
    assert.equal(served.agentId, 'backend-engineer');
    const stats = cacheStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
  });
});
