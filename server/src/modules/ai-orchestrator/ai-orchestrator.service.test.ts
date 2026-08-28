/**
 * AI Orchestrator tests (`npm test`). No real provider keys exist in CI,
 * so every end-to-end `generate()`/`retry()`/workflow test exercises the
 * mock provider — deterministic, offline, and exactly the path the model
 * router falls back to when no real provider is configured, which is
 * itself a real behavior worth covering. Each subsystem (prompt engine,
 * cache, retry, validation, context builder, compressor, history) also
 * gets focused unit tests independent of the network-facing providers.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  generate,
  retry,
  executeWorkflow,
  getHistory,
  getStatistics,
  getWorkflows,
} from './ai-orchestrator.service.js';
import { CacheManager } from './lib/cache-manager.js';
import { buildContext } from './lib/context-builder.js';
import { compressPrompt } from './lib/prompt-compressor.js';
import { getPromptTemplate, listPromptTemplates, renderPrompt } from './lib/prompt-engine.js';
import { resetHistoryForTests } from './lib/generation-history.js';
import { ModelRouter } from './lib/model-router.js';
import { getProvider, resolveProvider } from './lib/providers/provider-registry.js';
import { MockProvider } from './lib/providers/mock-provider.js';
import { ProviderCallError } from './lib/providers/http-utils.js';
import { withRetry, NonRetryableError } from './lib/retry-manager.js';
import { validateResponse } from './lib/response-validator.js';

beforeEach(() => {
  resetHistoryForTests();
});

describe('prompt engine', () => {
  it('lists every prompt template file on disk', () => {
    const templates = listPromptTemplates();
    const ids = templates.map((t) => t.id).sort();
    assert.deepEqual(ids, [
      'architecture-planner',
      'backend-generator',
      // The Context Engine's template: renders a compiled context into a
      // task prompt via {{PROJECT_CONTEXT}}.
      'context-task',
      'database-generator',
      'dependency-engine',
      'entity-fields',
      'frontend-generator',
      // The Product Architect's template: the planning mesh's one new
      // reasoning step.
      'product-architect',
      // The Repair Engineer's template: smallest change, authorized files only.
      'repair-engineer',
      'requirement-analyzer',
      'security-engine',
      // The Test Engineer's template: ranks the deterministic plan, only.
      'test-planner',
      // The UX Engineer's template: asked only what the deterministic
      // checks cannot answer.
      'ux-reviewer',
    ]);
  });

  it('extracts every {{VARIABLE}} placeholder from a template', () => {
    const template = getPromptTemplate('requirement-analyzer');
    assert.ok(template.variables.includes('PROJECT_NAME'));
    assert.ok(template.variables.includes('USER_REQUEST'));
  });

  it('renders a template and reports missing variables instead of guessing', () => {
    const rendered = renderPrompt('requirement-analyzer', { PROJECT_NAME: 'Acme' });
    assert.ok(rendered.text.includes('Acme'));
    assert.deepEqual(rendered.missingVariables, ['USER_REQUEST']);
  });

  it('fully substitutes every variable when all are provided', () => {
    const rendered = renderPrompt('requirement-analyzer', {
      PROJECT_NAME: 'Acme',
      USER_REQUEST: 'Build a CRM',
    });
    assert.equal(rendered.missingVariables.length, 0);
    assert.ok(!rendered.text.includes('{{'));
  });

  it('throws a clear error for an unknown template id', () => {
    assert.throws(() => getPromptTemplate('does-not-exist'), /Unknown prompt template/);
  });
});

describe('model router', () => {
  it('routes every task complexity to a configured provider (mock, absent real keys)', () => {
    const router = new ModelRouter();
    for (const complexity of [
      'simple-extraction',
      'large-planning',
      'small-file-regen',
      'complex-refactor',
    ] as const) {
      const routed = router.route(complexity);
      assert.ok(routed.provider.isConfigured());
    }
  });

  it('falls back through preferred -> fallback -> mock when nothing is configured', () => {
    const resolved = resolveProvider('claude', 'openai');
    assert.equal(resolved.id, 'mock');
  });

  it('throws for an unrouted complexity', () => {
    const router = new ModelRouter([]);
    assert.throws(() => router.route('simple-extraction'), /No route configured/);
  });
});

describe('providers', () => {
  it('the mock provider is always configured and deterministic per input', async () => {
    const provider = getProvider('mock');
    assert.ok(provider.isConfigured());
    const result = await provider.call({
      model: 'mock-1',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 100,
    });
    assert.equal(result.provider, 'mock');
    assert.ok(result.usage.inputTokens > 0);
  });

  it('real providers report unconfigured without a key, rather than throwing', () => {
    for (const id of ['claude', 'openai', 'gemini', 'openrouter'] as const) {
      const provider = getProvider(id);
      assert.equal(provider.isConfigured(), false);
    }
  });

  it('a custom mock responder makes provider output fully test-controllable', async () => {
    const provider = new MockProvider(() => JSON.stringify({ projectName: 'X' }));
    const result = await provider.call({
      model: 'mock-1',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10,
    });
    assert.equal(result.content, '{"projectName":"X"}');
  });
});

describe('cache manager', () => {
  it('is a miss until set, then a hit, and tracks a hit rate', () => {
    const cache = new CacheManager();
    const key = CacheManager.key('p', 'm', 'text');
    assert.equal(cache.get(key), null);
    cache.set(key, {
      content: 'ok',
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'm',
      provider: 'mock',
      stopReason: 'end_turn',
    });
    assert.ok(cache.get(key));
    const stats = cache.stats();
    assert.equal(stats.size, 1);
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 50);
  });

  it('different (promptId, model, text) tuples never collide', () => {
    const a = CacheManager.key('p1', 'm', 'text');
    const b = CacheManager.key('p2', 'm', 'text');
    assert.notEqual(a, b);
  });
});

describe('retry manager', () => {
  it('succeeds without retrying when the first attempt works', async () => {
    const outcome = await withRetry(async () => {
      await Promise.resolve();
      return 'ok';
    });
    assert.equal(outcome.result, 'ok');
    assert.equal(outcome.attempts.length, 0);
  });

  it('retries a classified, retryable error and eventually succeeds', async () => {
    let calls = 0;
    const outcome = await withRetry(
      async () => {
        await Promise.resolve();
        calls += 1;
        if (calls < 3) throw new ProviderCallError('rate-limit', 'slow down');
        return 'ok';
      },
      { baseDelayMs: 1, maxAttempts: 5 },
    );
    assert.equal(outcome.result, 'ok');
    assert.equal(outcome.attempts.length, 2);
    assert.ok(outcome.attempts.every((a) => a.errorKind === 'rate-limit'));
  });

  it('exhausts attempts and throws the last error', async () => {
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            await Promise.resolve();
            throw new ProviderCallError('network', 'down');
          },
          { baseDelayMs: 1, maxAttempts: 2 },
        ),
      /down/,
    );
  });

  it('never retries a NonRetryableError', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(async () => {
          await Promise.resolve();
          calls += 1;
          throw new NonRetryableError('stop');
        }),
      /stop/,
    );
    assert.equal(calls, 1);
  });
});

describe('response validator', () => {
  it('accepts any valid JSON under the generic schema', () => {
    const result = validateResponse('{"a":1}', 'generic-json');
    assert.equal(result.valid, true);
  });

  it('rejects invalid JSON regardless of schema', () => {
    const result = validateResponse('{not json', 'generic-json');
    assert.equal(result.valid, false);
    assert.equal(result.issues[0]?.kind, 'incomplete');
  });

  it('flags missing required fields for a known schema', () => {
    const result = validateResponse('{"projectName":"X"}', 'requirement-spec');
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'roles'));
    assert.ok(result.issues.some((i) => i.path === 'modules'));
  });

  it('passes when every required field is present', () => {
    const result = validateResponse(
      JSON.stringify({
        projectName: 'X',
        projectType: 'SaaS',
        roles: ['Admin'],
        modules: ['auth'],
      }),
      'requirement-spec',
    );
    assert.equal(result.valid, true);
  });
});

describe('context builder', () => {
  it('never includes duplicate file paths', () => {
    const context = buildContext({
      requirements: { projectName: 'X', projectType: 'SaaS' },
      architecture: { apiModules: [1, 2] },
      databaseDesign: { tables: [1] },
      affectedFiles: [
        { path: 'a.ts', content: 'export const a = 1;' },
        { path: 'a.ts', content: 'export const a = 2;' },
      ],
    });
    assert.equal(context.files.length, 1);
    assert.ok(context.summary.includes('X'));
  });

  it('truncates and reports omitted files once the token budget is exceeded', () => {
    const bigFile = { path: 'big.ts', content: 'x'.repeat(4000) };
    const context = buildContext(
      {
        requirements: {},
        architecture: {},
        databaseDesign: {},
        affectedFiles: [bigFile, { path: 'small.ts', content: 'y' }],
      },
      500,
    );
    assert.equal(context.truncated, true);
    assert.ok(context.omittedFiles.length > 0);
  });
});

describe('prompt compressor', () => {
  it('strips line comments and collapses blank lines without losing real content', () => {
    const input = '// a comment\nconst x = 1;\n\n\n\nconst y = 2;\n';
    const result = compressPrompt(input);
    assert.ok(!result.text.includes('// a comment'));
    assert.ok(result.text.includes('const x = 1;'));
    assert.ok(result.text.includes('const y = 2;'));
    assert.ok(result.compressedTokens <= result.originalTokens);
  });

  it('collapses consecutive duplicate lines', () => {
    const input = 'const x = 1;\nconst x = 1;\nconst x = 1;\n';
    const result = compressPrompt(input);
    assert.equal(result.text.split('\n').filter((l) => l.trim() === 'const x = 1;').length, 1);
  });
});

describe('generate() end-to-end (mock provider)', () => {
  it('produces a successful GenerationRecord and appears in history', async () => {
    const response = await generate({
      promptId: 'requirement-analyzer',
      variables: { PROJECT_NAME: 'Orbit', USER_REQUEST: 'A task tracker' },
      complexity: 'simple-extraction',
      schema: 'generic-json',
    });
    assert.equal(response.record.status, 'success');
    assert.equal(response.record.provider, 'mock');
    assert.ok(response.record.tokens.inputTokens > 0);
    assert.ok(response.content.length > 0);

    const history = getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0]?.id, response.record.id);
  });

  it('rejects a request missing a required prompt variable before ever calling a provider', async () => {
    await assert.rejects(
      () =>
        generate({
          promptId: 'requirement-analyzer',
          variables: { PROJECT_NAME: 'Orbit' },
          complexity: 'simple-extraction',
        }),
      /missing required variable/,
    );
    assert.equal(getHistory().length, 0);
  });

  it('a second identical request is served from cache', async () => {
    const variables = { PROJECT_NAME: 'CacheTest', USER_REQUEST: 'A blog' };
    const first = await generate({
      promptId: 'requirement-analyzer',
      variables,
      complexity: 'simple-extraction',
    });
    const second = await generate({
      promptId: 'requirement-analyzer',
      variables,
      complexity: 'simple-extraction',
    });

    assert.equal(first.record.cacheHit, false);
    assert.equal(second.record.cacheHit, true);
    assert.equal(second.record.status, 'cached');
    assert.equal(second.content, first.content);
  });

  it('retry() bypasses the cache even for an identical request', async () => {
    const variables = { PROJECT_NAME: 'RetryTest', USER_REQUEST: 'A wiki' };
    await generate({
      promptId: 'requirement-analyzer',
      variables,
      complexity: 'simple-extraction',
    });
    const retried = await retry({
      promptId: 'requirement-analyzer',
      variables,
      complexity: 'simple-extraction',
    });
    assert.equal(retried.record.cacheHit, false);
  });

  it('attaches a context package when context is provided', async () => {
    const response = await generate({
      promptId: 'dependency-engine',
      variables: { PROJECT_NAME: 'CtxTest', FEATURE: 'Add dark mode', DEPENDENCY_GRAPH: '{}' },
      complexity: 'small-file-regen',
      context: {
        requirements: { projectName: 'CtxTest' },
        architecture: {},
        databaseDesign: {},
        affectedFiles: [{ path: 'theme.store.ts', content: 'export const theme = {};' }],
      },
    });
    assert.ok(response.contextPackage);
    assert.equal(response.contextPackage.files.length, 1);
    assert.ok(response.compression);
  });
});

describe('workflow engine', () => {
  it('lists the built-in full-pipeline workflow', () => {
    const workflows = getWorkflows();
    assert.ok(workflows.some((w) => w.id === 'full-pipeline'));
  });

  it('runs only the steps a caller supplies input for — "individual workflow execution"', async () => {
    const run = await executeWorkflow('full-pipeline', [
      { name: 'requirement-analysis', variables: { PROJECT_NAME: 'WF', USER_REQUEST: 'A CRM' } },
    ]);
    assert.equal(run.status, 'completed');
    const requirementStep = run.steps.find((s) => s.name === 'requirement-analysis');
    assert.equal(requirementStep?.status, 'completed');
    const architectureStep = run.steps.find((s) => s.name === 'architecture');
    assert.equal(architectureStep?.status, 'pending');
  });

  it('marks a pipeline-reference step completed only when the caller says so', async () => {
    const run = await executeWorkflow('full-pipeline', [{ name: 'export', completed: true }]);
    const exportStep = run.steps.find((s) => s.name === 'export');
    assert.equal(exportStep?.status, 'completed');
  });

  it('throws for an unknown workflow id', async () => {
    await assert.rejects(() => executeWorkflow('does-not-exist', []), /Unknown workflow/);
  });
});

describe('generation history + statistics', () => {
  it('computes cost analytics across every recorded generation', async () => {
    await generate({
      promptId: 'requirement-analyzer',
      variables: { PROJECT_NAME: 'StatsTest', USER_REQUEST: 'A shop' },
      complexity: 'simple-extraction',
    });
    const stats = getStatistics();
    assert.equal(stats.totalGenerations, 1);
    assert.ok(stats.totalTokens > 0);
    assert.ok('mock' in stats.byProvider);
    assert.ok(stats.byComplexity['simple-extraction'] === 1);
  });
});
