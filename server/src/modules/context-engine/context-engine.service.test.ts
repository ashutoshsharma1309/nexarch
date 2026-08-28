/**
 * Context Engine unit tests (`npm test`).
 *
 * The engine's whole value is that it is deterministic and explainable, so
 * these tests assert on the parts where a silent failure would be
 * expensive: does selection actually exclude the irrelevant, does
 * truncation protect the important, does sanitization catch a real
 * credential, and is a token count honest about whether it is exact.
 *
 * The graph fixture is built by the real Phase 3 builder from a real
 * pipeline run, not hand-written — a fixture that agrees with itself
 * proves nothing about the selection rules.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import { buildGraph } from '../engineering-graph/lib/graph-builder.js';
import { budgetFor } from './lib/budgets.js';
import { compileContext } from './lib/compiler.js';
import { compress, stripNoise } from './lib/compressor.js';
import { resolveContext } from './lib/resolver.js';
import { sanitizeContext } from './lib/sanitizer.js';
import { selectArtifacts } from './lib/artifact-selector.js';
import {
  countTokens,
  recordActual,
  resetAccuracyForTests,
  tokenAccuracy,
} from './lib/token-counter.js';
import { cacheKey, readCache, resetCacheForTests, writeCache } from './lib/context-cache.js';
import { scoreNode, SCORE } from './lib/relevance.js';
import type { PipelineArtifacts } from '../pipeline/pipeline.types.js';
import type { GraphEdge, GraphNode } from '../../shared/contracts/index.js';
import type { CompiledContext, ScoredNode } from './context-engine.types.js';

const MODEL = 'openai/gpt-oss-120b';

/* ── Fixture: a real e-commerce project ───────────────────────────────── */

function buildArtifacts(prompt: string): PipelineArtifacts {
  const analysis = analyzeRequirements(prompt);
  assert.equal(analysis.status, 'COMPLETE');
  const requirements = analysis.spec;
  const { plan, markdown } = planArchitecture(requirements);
  const design = designDatabase(plan, requirements);
  const backend = generateBackend(
    plan,
    requirements,
    design.databaseDesign,
    design.prismaSchema,
    design.openapi,
    design.validationRules.entities,
    design.entityMetadata,
  );
  const backendManifest = { modules: backend.modules, routes: backend.routes };
  const frontend = generateFrontend(
    plan,
    requirements,
    design.databaseDesign,
    design.openapi,
    backendManifest,
    design.entityMetadata,
  );
  const security = applySecurity({
    requirements,
    architecture: plan,
    database: design.databaseDesign,
    openapi: design.openapi,
    entityMetadata: design.entityMetadata,
    backendManifest,
    frontendManifest: {
      pages: frontend.pages.map((p) => ({
        name: p.name,
        route: p.route,
        kind: p.kind,
        entity: p.entity,
        implemented: p.implemented,
      })),
    },
  });
  const { bundle: dependencies } = buildDependencyGraphBundle({
    requirements,
    architecture: plan,
    database: design.databaseDesign,
    backend: { files: backend.files, modules: backend.modules, routes: backend.routes },
    frontend: {
      files: frontend.files,
      pages: frontend.pages,
      components: frontend.components,
      routes: frontend.routes,
      stores: frontend.stores,
    },
    security: {
      backendFiles: security.backendFiles,
      frontendFiles: security.frontendFiles,
      rbac: { roles: security.rbac.roles, permissions: security.permissions },
    },
  });
  return {
    runId: 'test-run',
    requirements,
    architecture: plan,
    architectureMarkdown: markdown,
    design,
    backend,
    frontend,
    security,
    dependencies,
    files: [
      ...backend.files.map((f) => ({ path: `backend/${f.path}`, content: f.content })),
      ...frontend.files.map((f) => ({ path: `frontend/${f.path}`, content: f.content })),
    ],
  };
}

/** Materializes the draft into stored-shape nodes/edges. */
function materialize(artifacts: PipelineArtifacts): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const draft = buildGraph(artifacts);
  const now = new Date().toISOString();
  const idFor = (type: string, canonical: string): string => `${type}::${canonical}`;
  return {
    nodes: draft.nodes.map((node) => ({
      id: idFor(node.type, node.canonicalName),
      projectId: 'p1',
      runId: 'r1',
      type: node.type,
      canonicalName: node.canonicalName,
      name: node.name,
      description: node.description ?? null,
      metadata: node.metadata ?? {},
      sourceArtifactId: node.sourceArtifactId,
      createdAt: now,
      updatedAt: now,
    })),
    edges: draft.edges.map((edge, index) => ({
      id: `e${String(index)}`,
      projectId: 'p1',
      runId: 'r1',
      sourceNodeId: idFor(edge.from.type, edge.from.canonicalName),
      targetNodeId: idFor(edge.to.type, edge.to.canonicalName),
      relationship: edge.relationship,
      metadata: edge.metadata ?? {},
      createdAt: now,
    })),
  };
}

const ARTIFACTS = buildArtifacts(
  'Build an e-commerce platform with authentication, products, cart, orders and payments.',
);
const { nodes: NODES, edges: EDGES } = materialize(ARTIFACTS);

/* ── Token counting ───────────────────────────────────────────────────── */

describe('token counting', () => {
  it('counts exactly for models whose tokenizer runs locally', () => {
    const result = countTokens('Build an e-commerce platform with orders.', MODEL);
    assert.equal(result.exact, true);
    assert.equal(result.method, 'o200k-exact');
    assert.ok(result.tokens > 0);
  });

  it('never claims an estimate is exact', () => {
    const result = countTokens('Build an e-commerce platform.', 'claude-sonnet-5');
    assert.equal(result.exact, false);
    assert.equal(result.method, 'ratio-estimate');
  });

  it('beats the chars/4 rule of thumb it replaces', () => {
    const text = 'Build an e-commerce platform with authentication, products, cart and orders.';
    const exact = countTokens(text, MODEL).tokens;
    const naive = Math.ceil(text.length / 4);
    // chars/4 over-counts English prose; the exact count is the reference.
    assert.notEqual(exact, naive);
    assert.ok(Math.abs(exact - naive) / exact > 0.1, 'the naive rule is materially off');
  });

  it('reports its own error against real provider counts', () => {
    resetAccuracyForTests();
    recordActual(100, 100, 'o200k-exact');
    recordActual(90, 100, 'ratio-estimate');
    const accuracy = tokenAccuracy();
    assert.equal(accuracy.samples, 2);
    assert.equal(accuracy.exactSamples, 1);
    assert.ok(accuracy.meanErrorPercent > 0);
    resetAccuracyForTests();
  });
});

/* ── Relevance ────────────────────────────────────────────────────────── */

describe('relevance scoring', () => {
  const node = NODES.find((n) => n.type === 'SERVICE');

  it('scores a target above everything else', () => {
    assert.ok(node);
    const target = scoreNode({
      node,
      depth: 0,
      isTarget: true,
      isDirectDependency: false,
      isDirectDependent: false,
      sharesModule: false,
      task: 'BACKEND_GENERATION',
      requiredTypes: [],
    });
    assert.equal(target.score, SCORE.TARGET);
    assert.equal(target.reason, 'TARGET');
  });

  it('ranks a direct dependency above a direct dependent', () => {
    assert.ok(node);
    const base = {
      node,
      depth: 1,
      isTarget: false,
      sharesModule: false,
      task: 'BACKEND_GENERATION' as const,
      requiredTypes: [],
    };
    const dependency = scoreNode({ ...base, isDirectDependency: true, isDirectDependent: false });
    const dependent = scoreNode({ ...base, isDirectDependency: false, isDirectDependent: true });
    assert.ok(dependency.score > dependent.score);
    assert.equal(dependency.reason, 'DIRECT_DEPENDENCY');
    assert.equal(dependent.reason, 'DIRECT_DEPENDENT');
  });

  it('decays with distance so a far node cannot outrank a near one', () => {
    assert.ok(node);
    const base = {
      node,
      isTarget: false,
      isDirectDependency: false,
      isDirectDependent: false,
      sharesModule: false,
      task: 'BACKEND_GENERATION' as const,
      requiredTypes: [],
    };
    assert.ok(scoreNode({ ...base, depth: 2 }).score > scoreNode({ ...base, depth: 4 }).score);
  });

  it('is deterministic', () => {
    assert.ok(node);
    const input = {
      node,
      depth: 1,
      isTarget: false,
      isDirectDependency: true,
      isDirectDependent: false,
      sharesModule: true,
      task: 'BACKEND_GENERATION' as const,
      requiredTypes: [],
    };
    assert.deepEqual(scoreNode(input), scoreNode(input));
  });
});

/* ── Selection: the Step 27 case ──────────────────────────────────────── */

describe('selective context for BACKEND_GENERATION on Order Service', () => {
  const resolution = resolveContext(NODES, EDGES, {
    projectId: 'p1',
    taskType: 'BACKEND_GENERATION',
    targetNames: ['OrderService'],
    includeDependencies: true,
    includeDependents: true,
    dependencyDepth: 2,
  });

  const names = new Set(resolution.selected.map((entry) => entry.node.name));
  const excludedNames = new Set(resolution.excluded.map((entry) => entry.name));

  it('finds the target by name', () => {
    const target = resolution.selected.find((entry) => entry.reason === 'TARGET');
    assert.ok(target, 'OrderService should resolve as a target');
    assert.match(target.node.name, /Order/);
  });

  it('includes the entity the target persists', () => {
    assert.ok(names.has('Orders'), 'the Orders entity must be in context');
  });

  it('includes the endpoints the target serves', () => {
    const apis = resolution.selected.filter((entry) => entry.node.type === 'API');
    assert.ok(apis.length > 0, 'order endpoints must be in context');
  });

  it('selects far fewer nodes than the project contains', () => {
    assert.ok(
      resolution.selected.length < NODES.length,
      'selective context must not be the whole graph',
    );
    assert.ok(resolution.excluded.length > 0, 'something must be excluded');
  });

  it('excludes leaves that have nothing to do with the task', () => {
    // Individual npm packages are never relevant to writing a service.
    const dependencies = resolution.selected.filter((e) => e.node.type === 'DEPENDENCY');
    assert.equal(dependencies.length, 0, 'npm packages are not backend-generation context');
    assert.ok(excludedNames.size > 0);
  });

  it('orders selection by relevance so truncation is safe', () => {
    const scores = resolution.selected.map((entry) => entry.score);
    assert.deepEqual(
      scores,
      [...scores].sort((a, b) => b - a),
    );
  });

  it('gives every selected node an explainable reason', () => {
    assert.ok(resolution.selected.every((entry) => entry.reason.length > 0));
    assert.ok(resolution.excluded.every((entry) => entry.reason.length > 0));
  });
});

describe('depth bounding', () => {
  const at = (depth: number): number =>
    resolveContext(NODES, EDGES, {
      projectId: 'p1',
      taskType: 'BACKEND_GENERATION',
      targetNames: ['OrderService'],
      dependencyDepth: depth,
    }).selected.length;

  it('selects more as depth grows, and never the whole graph at depth 1', () => {
    const d1 = at(1);
    const d2 = at(2);
    assert.ok(d2 >= d1, 'deeper traversal reaches at least as much');
    assert.ok(d1 < NODES.length, 'depth 1 must not pull the project');
  });
});

describe('FULL mode', () => {
  it('is the control arm: every node, no scoring', () => {
    const full = resolveContext(NODES, EDGES, {
      projectId: 'p1',
      taskType: 'BACKEND_GENERATION',
      targetNames: ['OrderService'],
      mode: 'FULL',
    });
    assert.equal(full.selected.length, NODES.length);
    assert.equal(full.excluded.length, 0);
  });

  /**
   * FULL sends strictly more nodes than SELECTIVE, so it must never say
   * less about the target. It used to: every node came back with reason
   * `FULL_MODE`, the compiler found no target to write a TARGET section
   * for, and the node being generated was rendered as one summary line
   * among all the others.
   */
  it('still knows which node the task is about', () => {
    const full = resolveContext(NODES, EDGES, {
      projectId: 'p1',
      taskType: 'BACKEND_GENERATION',
      targetNames: ['OrderService'],
      mode: 'FULL',
    });
    const targets = full.selected.filter((entry) => entry.reason === 'TARGET');
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.node.name, 'OrderService');
  });

  it('is a superset of what SELECTIVE says about the target', () => {
    const hasTarget = (context: CompiledContext): boolean =>
      context.sections.some((section) => section.title === 'TARGET');

    assert.ok(hasTarget(compile()), 'SELECTIVE writes a TARGET section');
    assert.ok(
      hasTarget(
        compile({
          mode: 'FULL',
          selected: resolveContext(NODES, EDGES, {
            projectId: 'p1',
            taskType: 'BACKEND_GENERATION',
            targetNames: ['OrderService'],
            mode: 'FULL',
          }).selected,
        }),
      ),
      'FULL writes a TARGET section too',
    );
  });
});

/* ── Artifacts ────────────────────────────────────────────────────────── */

describe('artifact selection', () => {
  const selected = resolveContext(NODES, EDGES, {
    projectId: 'p1',
    taskType: 'BACKEND_GENERATION',
    targetNames: ['OrderService'],
  }).selected;

  it('requests what the task needs and nothing else', () => {
    const plan = selectArtifacts('BACKEND_GENERATION', selected, undefined, false);
    assert.ok(plan.needed.includes('database-design'));
    assert.ok(plan.needed.includes('architecture-plan'));
    // Source bundles are the largest artifacts; excluded unless asked for.
    assert.ok(!plan.needed.includes('project-files'));
    assert.ok(plan.excluded.some((entry) => entry.type === 'frontend-source'));
  });

  it('includes source bundles only when the task reads code', () => {
    const plan = selectArtifacts('BACKEND_GENERATION', selected, undefined, true);
    assert.ok(plan.needed.includes('backend-source'));
  });

  it('honours an explicit request verbatim', () => {
    const plan = selectArtifacts('BACKEND_GENERATION', selected, ['security-report'], false);
    assert.deepEqual(plan.needed, ['security-report']);
  });
});

/* ── Compilation, budget and truncation ───────────────────────────────── */

function compile(overrides: Partial<Parameters<typeof compileContext>[0]> = {}): CompiledContext {
  const selected: ScoredNode[] = resolveContext(NODES, EDGES, {
    projectId: 'p1',
    taskType: 'BACKEND_GENERATION',
    targetNames: ['OrderService'],
  }).selected;

  return compileContext({
    projectId: 'p1',
    runId: 'r1',
    taskType: 'BACKEND_GENERATION',
    mode: 'SELECTIVE',
    instruction: 'Regenerate the order service.',
    selected,
    artifacts: { 'database-design': ARTIFACTS.design.databaseDesign },
    maxContextTokens: 8000,
    maxOutputTokens: 8192,
    model: MODEL,
    startedAt: Date.now(),
    trace: {
      selected: [],
      excluded: [],
      artifactsIncluded: ['database-design'],
      artifactsExcluded: [],
      cache: 'miss',
      graphNodesConsidered: NODES.length,
    },
    ...overrides,
  });
}

describe('context compilation', () => {
  const context = compile();

  it('produces structured sections, task first', () => {
    assert.equal(context.sections[0]?.title, 'TASK');
    assert.ok(context.text.includes('## TASK'));
    assert.ok(context.text.includes('BACKEND_GENERATION'));
  });

  it('carries the target and its database shape', () => {
    assert.ok(context.text.includes('## TARGET'));
    assert.ok(context.text.includes('## DATABASE'));
    assert.ok(context.text.includes('Orders'));
  });

  it('reports an exact token count for a local-tokenizer model', () => {
    assert.equal(context.tokensAreExact, true);
    assert.ok(context.tokens > 0);
    assert.equal(context.budget.withinBudget, true);
  });

  it('keeps the input budget separate from the output limit', () => {
    assert.equal(context.budget.maxContextTokens, 8000);
    assert.equal(context.budget.maxOutputTokens, 8192);
    assert.notEqual(context.budget.maxContextTokens, context.budget.usedContextTokens);
  });

  it('drops whole low-priority sections under a tight budget, never the task', () => {
    const tight = compile({ maxContextTokens: 120 });
    assert.ok(tight.trace.truncatedSections.length > 0, 'something must have been dropped');
    // The task and the target survive: a context that lost its own brief is
    // broken, not small.
    assert.ok(tight.text.includes('## TASK'));
    assert.ok(tight.tokens < context.tokens);
  });

  it('never cuts a section mid-way', () => {
    const tight = compile({ maxContextTokens: 200 });
    for (const section of tight.sections) {
      assert.ok(tight.text.includes(section.content), 'sections are whole or absent');
    }
  });
});

/* ── Compression ──────────────────────────────────────────────────────── */

describe('compression', () => {
  it('removes storage metadata that carries no design information', () => {
    const stripped = stripNoise({
      entity: 'Orders',
      id: 'cuid123',
      createdAt: '2026-01-01T00:00:00Z',
      columns: ['total'],
    }) as Record<string, unknown>;
    assert.equal(stripped.entity, 'Orders');
    assert.equal(stripped.id, undefined);
    assert.equal(stripped.createdAt, undefined);
    assert.deepEqual(stripped.columns, ['total']);
  });

  it('collapses whitespace and repeated lines without losing content', () => {
    const text = 'Orders\n\n\n\nOrders\nOrders\nPayments   \n';
    const outcome = compress(text, (value) => countTokens(value, MODEL).tokens);
    assert.ok(outcome.text.includes('Orders'));
    assert.ok(outcome.text.includes('Payments'));
    assert.ok(outcome.tokensSaved >= 0);
    assert.ok(outcome.applied.length > 0);
  });

  it('leaves technical content intact', () => {
    const text = 'Orders (orders): id:CHAR(36), total:DECIMAL(10,2), status:ENUM';
    const outcome = compress(text, (value) => countTokens(value, MODEL).tokens);
    assert.equal(outcome.text, text);
  });
});

/* ── Sanitization ─────────────────────────────────────────────────────── */

describe('sanitization', () => {
  it('redacts provider keys, JWTs and connection credentials', () => {
    const dirty = [
      'AI_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz012345',
      'DATABASE_URL="mysql://root:supersecret@localhost:3306/app"',
      'JWT_SECRET=averylongsecretvaluehere',
      'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop',
    ].join('\n');

    const clean = sanitizeContext(dirty);
    assert.ok(!clean.text.includes('gsk_abcdefghijklmnopqrstuvwxyz012345'));
    assert.ok(!clean.text.includes('supersecret'));
    assert.ok(!clean.text.includes('averylongsecretvaluehere'));
    assert.ok(clean.redactions >= 4);
    assert.ok(clean.kinds.length > 0);
  });

  it('keeps the non-secret shape so the model still understands the config', () => {
    const clean = sanitizeContext('DATABASE_URL="mysql://root:pw123456@localhost:3306/app"');
    assert.ok(clean.text.includes('mysql://'));
    assert.ok(clean.text.includes('localhost:3306/app'));
  });

  it('leaves ordinary technical text alone', () => {
    const text = 'Orders belongs to Users via user_id. Status is an enum.';
    assert.equal(sanitizeContext(text).text, text);
    assert.equal(sanitizeContext(text).redactions, 0);
  });

  it('runs on every compiled context, not on request', () => {
    const context = compile({
      selected: [],
      artifacts: { 'database-design': { note: 'AI_API_KEY=gsk_leakedkeyleakedkeyleaked12345' } },
      instruction: 'password: hunter2000000',
    });
    assert.ok(!context.text.includes('gsk_leakedkeyleakedkeyleaked12345'));
    assert.ok(!context.text.includes('hunter2000000'));
  });
});

/* ── Cache ────────────────────────────────────────────────────────────── */

describe('context cache', () => {
  it('keys on everything that changes the result', () => {
    resetCacheForTests();
    const base = { projectId: 'p1', taskType: 'BACKEND_GENERATION' as const };
    const a = cacheKey(base, 'v1');
    assert.equal(cacheKey(base, 'v1'), a, 'same request, same key');
    assert.notEqual(cacheKey(base, 'v2'), a, 'a changed graph changes the key');
    assert.notEqual(cacheKey({ ...base, dependencyDepth: 3 }, 'v1'), a);
    assert.notEqual(cacheKey({ ...base, mode: 'FULL' }, 'v1'), a);
    assert.notEqual(cacheKey({ ...base, taskType: 'CODE_REVIEW' }, 'v1'), a);
  });

  it('returns what it stored and misses on an unknown key', () => {
    resetCacheForTests();
    const context = compile();
    writeCache('k1', context);
    assert.equal(readCache('k1')?.tokens, context.tokens);
    assert.equal(readCache('k2'), null);
    resetCacheForTests();
  });
});

/* ── Budgets ──────────────────────────────────────────────────────────── */

describe('task budgets', () => {
  it('gives every task an input ceiling and a separate output ceiling', () => {
    for (const task of [
      'REQUIREMENT_ANALYSIS',
      'ARCHITECTURE_PLANNING',
      'BACKEND_GENERATION',
      'SECURITY_REVIEW',
    ] as const) {
      const budget = budgetFor(task);
      assert.ok(budget.maxContextTokens > 0);
      assert.ok(budget.maxOutputTokens > 0);
      assert.ok(budget.defaultDepth >= 1 && budget.defaultDepth <= 4);
    }
  });

  it('budgets generation more input than requirement analysis', () => {
    assert.ok(
      budgetFor('BACKEND_GENERATION').maxContextTokens >
        budgetFor('REQUIREMENT_ANALYSIS').maxContextTokens,
    );
  });
});
