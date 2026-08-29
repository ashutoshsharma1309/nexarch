/**
 * Review mesh tests (`npm test`).
 *
 * The claims Phase 9 makes are the tests: the checks detect issues that
 * are really present (Step 32), invent none on a clean project (Step 33),
 * redact every secret they report, deduplicate across agents and reviews,
 * and count their summary from actual findings rather than asserting one.
 *
 * The clean-project fixture is real generator output, same as the
 * generation-mesh suite — a detection test against a fixture written to be
 * detected proves only that the author can write fixtures. The intentional
 * issues are *injected into that real output*, so each detection test
 * starts from a project the checks otherwise pass.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { buildGraph } from '../engineering-graph/lib/graph-builder.js';
import { AGENT_DEFINITIONS, getAgentDefinition } from '../../shared/contracts/index.js';
import { TASK_TYPES } from '../context-engine/context-engine.types.js';
import { buildPlan, computeWaves } from './lib/planner.js';
import { redact, scanSource } from './lib/source-security.js';
import { importedPackages, reviewDependencies } from './lib/dependency-review.js';
import { reviewQuality } from './lib/quality-review.js';
import {
  beginReview,
  findingKey,
  findingsForReview,
  listFindings,
  recordFinding,
  resetFindingStoreForTests,
  setFindingStatus,
} from './lib/finding-store.js';
import { computeScore, summarizeReview } from './lib/review-summary.js';
import type { AgentFinding } from '../../shared/contracts/index.js';
import type { DependencyArea } from './lib/dependency-review.js';

/* ── Fixture: a real e-commerce project, generated end to end ─────────── */

const analysis = analyzeRequirements(
  'Build an e-commerce platform with authentication, products, cart, orders, payments and inventory.',
);
assert.equal(analysis.status, 'COMPLETE');
const REQUIREMENTS = analysis.spec;
const ARCHITECTURE = planArchitecture(REQUIREMENTS).plan;
const DESIGN = designDatabase(ARCHITECTURE, REQUIREMENTS);

const BACKEND = generateBackend(
  ARCHITECTURE,
  REQUIREMENTS,
  DESIGN.databaseDesign,
  DESIGN.prismaSchema,
  DESIGN.openapi,
  DESIGN.validationRules.entities,
  DESIGN.entityMetadata,
);

const FRONTEND = generateFrontend(
  ARCHITECTURE,
  REQUIREMENTS,
  DESIGN.databaseDesign,
  DESIGN.openapi,
  { modules: BACKEND.modules, routes: BACKEND.routes },
  DESIGN.entityMetadata,
);

const ALL_FILES = [
  ...BACKEND.files.map((file) => ({ path: `backend/${file.path}`, content: file.content })),
  ...FRONTEND.files.map((file) => ({ path: `frontend/${file.path}`, content: file.content })),
];

function backendArea(overrides: Partial<DependencyArea> = {}): DependencyArea {
  const manifest = BACKEND.files.find((file) => file.path === 'package.json');
  assert.ok(manifest);
  return {
    area: 'backend',
    manifest: JSON.parse(manifest.content) as DependencyArea['manifest'],
    files: BACKEND.files,
    hasLockfile: false,
    ...overrides,
  };
}

/* ── Declarations ─────────────────────────────────────────────────────── */

describe('review mesh declarations', () => {
  it('enables the three review agents', () => {
    for (const id of [
      'security-engineer',
      'dependency-engineer',
      'code-quality-engineer',
    ] as const) {
      const definition = getAgentDefinition(id);
      assert.ok(definition, `${id} is not declared`);
      assert.equal(definition.enabled, true);
    }
  });

  /** Step 27's guarantee, stated as data the scheduler enforces. */
  it('declares every reviewer as read-only', () => {
    for (const id of [
      'security-engineer',
      'dependency-engineer',
      'code-quality-engineer',
    ] as const) {
      const definition = getAgentDefinition(id);
      assert.ok(definition);
      assert.deepEqual(definition.mutates, [], `${id} declares mutations`);
      assert.equal(definition.revises, undefined, `${id} revises artifacts`);
    }
  });

  it('still gives every artifact exactly one author', () => {
    const owners = new Map<string, string[]>();
    for (const definition of AGENT_DEFINITIONS) {
      if (!definition.enabled) continue;
      for (const type of definition.produces) {
        owners.set(type, [...(owners.get(type) ?? []), definition.id]);
      }
    }
    for (const [type, producers] of owners) {
      assert.equal(producers.length, 1, `${type} has ${String(producers.length)} authors`);
    }
  });

  /** Step 17: one wave, after generation, no order among them. */
  it('places all three reviewers in the same wave, after the UX engineer', () => {
    const plan = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      agentIds: [
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
      ],
      priority: 'NORMAL',
    });
    const waves = computeWaves(plan.tasks);
    const agentOf = new Map(plan.tasks.map((task) => [task.id, task.agentId]));
    const waveOf = (agentId: string): number =>
      waves.findIndex((wave) => wave.some((taskId) => agentOf.get(taskId) === agentId));

    const security = waveOf('security-engineer');
    assert.equal(waveOf('dependency-engineer'), security);
    assert.equal(waveOf('code-quality-engineer'), security);
    assert.ok(security > waveOf('frontend-engineer'));
  });
});

describe('context task registry', () => {
  /**
   * TASK_TYPES is a runtime list over a compile-time union, and the two can
   * drift: adding DEPENDENCY_REVIEW to the union compiled cleanly while the
   * validator, which reads the list, rejected the new task at runtime. Every
   * task an enabled agent declares must be in the list.
   */
  it('accepts every context an enabled agent declares', () => {
    for (const definition of AGENT_DEFINITIONS) {
      if (!definition.enabled || !definition.requiredContext) continue;
      assert.ok(
        (TASK_TYPES as readonly string[]).includes(definition.requiredContext),
        `${definition.id} requires ${definition.requiredContext}, which TASK_TYPES does not list`,
      );
    }
  });
});

/* ── Security detection (Step 32) ─────────────────────────────────────── */

describe('security detection', () => {
  it('detects a hard-coded API key and never repeats its value', () => {
    const secret = 'gsk_testFAKEkeyABCDEF1234567890abcd';
    const findings = scanSource({
      files: [
        ...ALL_FILES,
        { path: 'backend/src/shared/config/keys.ts', content: `export const KEY = '${secret}';\n` },
      ],
      authExpected: true,
    });

    const leak = findings.filter((finding) => finding.category === 'SECRETS');
    assert.equal(leak.length, 1);
    const [leaked] = leak;
    assert.ok(leaked);
    assert.equal(leaked.severity, 'CRITICAL');
    assert.equal(leaked.targetFile, 'backend/src/shared/config/keys.ts');
    // The finding must not be the leak.
    const serialized = JSON.stringify(leak);
    assert.ok(!serialized.includes(secret), 'the finding contains the secret it reports');
  });

  it('detects an authorization gap injected into a real router', () => {
    // A protected endpoint with its guard removed — Step 32's example.
    const stripped = ALL_FILES.map((file) =>
      file.path.includes('backend/src/modules/products/routes/')
        ? {
            ...file,
            content: file.content
              .replace(/requireAuth,?\s*/g, '')
              .replace(/requireRoles\([^)]*\),?\s*/g, ''),
          }
        : file,
    );
    const findings = scanSource({ files: stripped, authExpected: true });
    assert.ok(
      findings.some(
        (finding) =>
          finding.category === 'AUTHORIZATION' && (finding.targetFile ?? '').includes('products'),
      ),
      'an unguarded router was not reported',
    );
  });

  it('detects eval, unsafe SQL, wildcard CORS with credentials, and a bare cookie', () => {
    const planted = [
      {
        path: 'backend/src/bad/handler.ts',
        content: [
          'const result = eval(request.body.expression);',
          'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',
        ].join('\n'),
      },
      {
        path: 'backend/src/bad/app.ts',
        content: "app.use(cors({ origin: '*', credentials: true }));",
      },
      {
        path: 'backend/src/bad/session.ts',
        content: "res.cookie('session', token, { path: '/' });",
      },
    ];
    const findings = scanSource({ files: planted, authExpected: false });
    const categories = new Set(findings.map((finding) => finding.category));
    assert.ok(categories.has('INJECTION'));
    assert.ok(categories.has('CONFIGURATION'));
    assert.ok(categories.has('AUTHENTICATION'));
    const cors = findings.find((finding) => finding.title.includes('CORS'));
    assert.equal(cors?.severity, 'HIGH'); // wildcard + credentials
  });

  it('cites a file and line in every source finding', () => {
    const findings = scanSource({
      files: [{ path: 'backend/src/x.ts', content: 'const y = eval(z);\n' }],
      authExpected: false,
    });
    assert.match(findings[0]?.evidence ?? '', /backend\/src\/x\.ts:1/);
  });

  it('does not flag placeholders, env reads, or example files', () => {
    const findings = scanSource({
      files: [
        { path: 'backend/.env.example', content: 'API_KEY=gsk_replaceWithYourRealKey12345\n' },
        { path: 'backend/src/config.ts', content: "const key = process.env.API_KEY ?? '';\n" },
        { path: 'backend/src/other.ts', content: "const password = 'change_me_please';\n" },
      ],
      authExpected: false,
    });
    assert.deepEqual(
      findings.filter((finding) => finding.category === 'SECRETS'),
      [],
    );
  });

  it('redacts to a shape, not a value', () => {
    assert.equal(redact('abc'), '****');
    const redacted = redact('gsk_1234567890abcdefghij');
    assert.ok(redacted.startsWith('gsk_'));
    assert.ok(!redacted.includes('1234567890abcdefghij'));
  });
});

/* ── Dependency detection (Step 32) ───────────────────────────────────── */

describe('dependency detection', () => {
  it('detects an unused dependency added to a real manifest', () => {
    const area = backendArea();
    area.manifest.dependencies = { ...area.manifest.dependencies, 'left-pad': '^1.3.0' };
    const review = reviewDependencies([area]);
    const unused = review.findings.find(
      (finding) => finding.category === 'UNUSED_DEPENDENCY' && finding.title.includes('left-pad'),
    );
    assert.ok(unused, 'the planted unused dependency was not reported');
  });

  /**
   * The regression that shaped the import scanner: `import 'dotenv/config'`
   * has no binding, and a scanner that only reads `from '…'` calls dotenv
   * unused on a project whose config depends on it.
   */
  it('counts a side-effect import as usage', () => {
    const used = importedPackages([{ path: 'src/env.ts', content: "import 'dotenv/config';\n" }]);
    assert.ok(used.has('dotenv'));

    const review = reviewDependencies([backendArea()]);
    assert.ok(
      !review.findings.some((finding) => finding.title.includes('dotenv')),
      'dotenv was reported despite its side-effect import',
    );
  });

  it('detects an import with no declaration behind it', () => {
    const area = backendArea({
      files: [
        ...BACKEND.files.map((file) => ({ path: file.path, content: file.content })),
        { path: 'src/extra.ts', content: "import dayjs from 'dayjs';\n" },
      ],
    });
    const review = reviewDependencies([area]);
    const missing = review.findings.find(
      (finding) => finding.category === 'MISSING_DEPENDENCY' && finding.title.includes('dayjs'),
    );
    assert.equal(missing?.severity, 'HIGH');
  });

  it('detects a server-side package in the frontend manifest', () => {
    const review = reviewDependencies([
      {
        area: 'frontend',
        manifest: { dependencies: { react: '^19.0.0', '@prisma/client': '^6.0.0' } },
        files: [],
        hasLockfile: false,
      },
    ]);
    const boundary = review.findings.find((finding) => finding.category === 'BOUNDARY_VIOLATION');
    assert.ok(boundary);
    assert.equal(boundary.severity, 'HIGH');
    assert.match(boundary.description, /credential/i);
  });

  it('detects double declaration and cross-area drift', () => {
    const review = reviewDependencies([
      {
        area: 'backend',
        manifest: { dependencies: { zod: '^3.24.0' }, devDependencies: { zod: '^3.22.0' } },
        files: [{ path: 'src/a.ts', content: "import { z } from 'zod';\n" }],
        hasLockfile: false,
      },
      {
        area: 'frontend',
        manifest: { dependencies: { zod: '^4.0.0' } },
        files: [{ path: 'src/b.ts', content: "import { z } from 'zod';\n" }],
        hasLockfile: false,
      },
    ]);
    const categories = review.findings.map((finding) => finding.category);
    assert.ok(categories.includes('DUPLICATE_DEPENDENCY'));
    assert.ok(categories.includes('VERSION_DRIFT'));
  });

  /**
   * The false positives a live run surfaced, pinned so they stay fixed.
   * Each of these was reported as a real finding on a clean project:
   * `node:http` as an undeclared package, `jest` as a runtime dependency
   * because generated test scaffolds import it, and tool config counting
   * as runtime source.
   */
  it('treats node: specifiers as builtins wherever they appear', () => {
    const used = importedPackages([
      {
        path: 'src/server.ts',
        content: "import http from 'node:http';\nimport { URL } from 'node:url';\n",
      },
    ]);
    assert.deepEqual([...used], []);
  });

  it('does not count test scaffolds or tool config as runtime imports', () => {
    const review = reviewDependencies([
      {
        area: 'backend',
        manifest: {
          dependencies: { express: '^5.0.0' },
          devDependencies: { jest: '^29.0.0', 'typescript-eslint': '^8.0.0' },
        },
        files: [
          { path: 'src/index.ts', content: "import express from 'express';\n" },
          { path: 'tests/products.test.ts', content: "import { jest } from 'jest';\n" },
          { path: 'eslint.config.js', content: "import tseslint from 'typescript-eslint';\n" },
        ],
        hasLockfile: false,
      },
    ]);
    assert.deepEqual(
      review.findings.filter((finding) => finding.category === 'DEV_DEPENDENCY_AT_RUNTIME'),
      [],
    );
  });

  /** Step 11: never invent CVE data — say the scan did not run. */
  it('states that vulnerability verification was not performed', () => {
    const review = reviewDependencies([backendArea()]);
    assert.equal(review.vulnerabilityScan.performed, false);
    assert.ok(review.vulnerabilityScan.reason.length > 0);
  });
});

/* ── Code quality detection (Step 32) ─────────────────────────────────── */

describe('code quality detection', () => {
  const baseInput = {
    projectName: REQUIREMENTS.projectName,
    architecture: ARCHITECTURE,
    api: DESIGN.openapi,
    backendFiles: BACKEND.files.map((file) => ({
      path: `backend/${file.path}`,
      content: file.content,
    })),
    frontendFiles: FRONTEND.files.map((file) => ({
      path: `frontend/${file.path}`,
      content: file.content,
    })),
    backendModules: BACKEND.modules.map((mod) => ({ name: mod.name, entity: mod.entity })),
    backendRoutes: BACKEND.routes.map((route) => ({ method: route.method, path: route.path })),
  };

  it('detects a planned module the backend never built', () => {
    const review = reviewQuality({
      ...baseInput,
      // Drop the first module from what was "built".
      backendModules: baseInput.backendModules.slice(1),
    });
    const drift = review.findings.find((finding) => finding.category === 'ARCHITECTURE_DRIFT');
    assert.ok(drift, 'the dropped module was not reported');
    assert.equal(drift.severity, 'HIGH');
  });

  it('detects duplicated logic planted across two files', () => {
    const block = BACKEND.files.find((file) => file.path.endsWith('.service.ts'));
    assert.ok(block);
    const review = reviewQuality({
      ...baseInput,
      backendFiles: [
        ...baseInput.backendFiles,
        { path: 'backend/src/copy-one.ts', content: block.content },
        { path: 'backend/src/copy-two.ts', content: block.content },
      ],
    });
    assert.ok(
      review.findings.some((finding) => finding.category === 'DUPLICATION'),
      'the planted duplication was not reported',
    );
  });

  it('detects an empty catch block', () => {
    const review = reviewQuality({
      ...baseInput,
      backendFiles: [
        ...baseInput.backendFiles,
        {
          path: 'backend/src/swallow.ts',
          content: 'try {\n  run();\n} catch {}\n',
        },
      ],
    });
    const swallowed = review.findings.find((finding) => finding.category === 'ERROR_HANDLING');
    assert.match(swallowed?.evidence ?? '', /swallow\.ts/);
  });

  it('does not call a large data file a code quality problem', () => {
    const review = reviewQuality({
      ...baseInput,
      frontendFiles: [
        ...baseInput.frontendFiles,
        {
          path: 'frontend/frontend-manifest.json',
          content: `{"rows": [${Array.from({ length: 600 }, () => '1').join(',\n')}]}`,
        },
      ],
    });
    assert.ok(
      !review.findings.some(
        (finding) =>
          finding.category === 'LARGE_FILE' && (finding.targetFile ?? '').endsWith('.json'),
      ),
      'a JSON manifest was reported as a large code file',
    );
  });

  it('detects endpoints the contract declares that nothing serves', () => {
    const review = reviewQuality({ ...baseInput, backendRoutes: baseInput.backendRoutes.slice(4) });
    assert.ok(review.findings.some((finding) => finding.category === 'CONTRACT_MISMATCH'));
  });
});

/* ── Clean project (Step 33) ──────────────────────────────────────────── */

describe('clean project review', () => {
  it('fabricates no security findings against the real generated source', () => {
    const findings = scanSource({ files: ALL_FILES, authExpected: true });
    // The generator emits no secrets, no eval, no raw SQL. If any of these
    // fire on clean output, the check is wrong, not the project.
    for (const category of ['SECRETS', 'INJECTION']) {
      assert.deepEqual(
        findings.filter((finding) => finding.category === category),
        [],
        `${category} reported on clean generated source`,
      );
    }
  });

  it('reports every finding with evidence and a real severity', () => {
    const security = scanSource({ files: ALL_FILES, authExpected: true });
    const dependency = reviewDependencies([backendArea()]).findings;
    for (const finding of [...security, ...dependency]) {
      assert.ok(finding.evidence, `${finding.title} has no evidence`);
      assert.ok(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(finding.severity));
    }
  });

  it('does not force a clean dependency review to zero findings', () => {
    // The INFO finding about the skipped vulnerability scan is legitimate
    // and must survive — a review scrubbed to zero would be dishonest in
    // the other direction.
    const review = reviewDependencies([backendArea()]);
    assert.ok(review.findings.some((finding) => finding.category === 'VULNERABILITY_SCAN'));
  });
});

/* ── Finding store (Steps 18, 20, 29) ─────────────────────────────────── */

describe('finding store', () => {
  beforeEach(() => {
    resetFindingStoreForTests();
  });

  const finding = (overrides: Partial<AgentFinding> = {}): AgentFinding => ({
    type: 'SECURITY',
    severity: 'HIGH',
    category: 'AUTHORIZATION',
    title: 'Missing ownership validation',
    description: 'Order data returned without checking the requesting user.',
    targetNodeId: null,
    targetFile: 'backend/src/modules/orders/orders.router.ts',
    evidence: 'orders.router.ts:12',
    recommendation: 'Check ownership before returning.',
    confidence: 0.9,
    status: 'OPEN',
    ...overrides,
  });

  it('gives the same problem the same identity across agents and runs', () => {
    const version = beginReview('p1');
    const first = recordFinding({
      projectId: 'p1',
      runId: 'r1',
      agentId: 'security-engineer',
      reviewVersion: version,
      finding: finding(),
    });
    const again = recordFinding({
      projectId: 'p1',
      runId: 'r2',
      agentId: 'code-quality-engineer',
      reviewVersion: version,
      finding: finding({ title: 'Missing ownership validation (3 routes)' }),
    });
    assert.equal(first.isNew, true);
    assert.equal(again.isNew, false);
    assert.equal(first.record.id, again.record.id);
    assert.equal(listFindings('p1').length, 1);
    // The re-observation refreshed the description.
    assert.match(again.record.title, /3 routes/);
  });

  it('keeps genuinely different problems apart', () => {
    const version = beginReview('p1');
    recordFinding({
      projectId: 'p1',
      runId: 'r1',
      agentId: 'security-engineer',
      reviewVersion: version,
      finding: finding(),
    });
    recordFinding({
      projectId: 'p1',
      runId: 'r1',
      agentId: 'security-engineer',
      reviewVersion: version,
      finding: finding({ category: 'INJECTION' }),
    });
    recordFinding({
      projectId: 'p1',
      runId: 'r1',
      agentId: 'security-engineer',
      reviewVersion: version,
      finding: finding({ targetFile: 'backend/src/modules/users/users.router.ts' }),
    });
    assert.equal(listFindings('p1').length, 3);
  });

  it('preserves a person’s judgement across re-observation', () => {
    const v1 = beginReview('p1');
    const { record } = recordFinding({
      projectId: 'p1',
      runId: 'r1',
      agentId: 'security-engineer',
      reviewVersion: v1,
      finding: finding(),
    });
    setFindingStatus('p1', record.id, 'FALSE_POSITIVE');

    const v2 = beginReview('p1');
    const reobserved = recordFinding({
      projectId: 'p1',
      runId: 'r2',
      agentId: 'security-engineer',
      reviewVersion: v2,
      finding: finding(),
    });
    assert.equal(reobserved.record.status, 'FALSE_POSITIVE');
    assert.equal(reobserved.record.firstSeenReview, v1);
    assert.equal(reobserved.record.lastSeenReview, v2);
  });

  it('scopes findings to the review that saw them', () => {
    const v1 = beginReview('p1');
    recordFinding({
      projectId: 'p1',
      runId: 'r1',
      agentId: 'security-engineer',
      reviewVersion: v1,
      finding: finding(),
    });
    const v2 = beginReview('p1');
    recordFinding({
      projectId: 'p1',
      runId: 'r2',
      agentId: 'security-engineer',
      reviewVersion: v2,
      finding: finding({ category: 'SECRETS', title: 'other' }),
    });
    // v2 saw only its own finding; the v1 finding was not re-observed.
    assert.equal(findingsForReview('p1', v2).length, 1);
  });

  it('derives identity from content, not from time', () => {
    const a = findingKey('p1', 'SECURITY', 'AUTHORIZATION', 'backend/x.ts');
    const b = findingKey('p1', 'SECURITY', 'AUTHORIZATION', 'backend/x.ts');
    const c = findingKey('p2', 'SECURITY', 'AUTHORIZATION', 'backend/x.ts');
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

/* ── Summary and score (Steps 22, 23) ─────────────────────────────────── */

describe('review summary', () => {
  beforeEach(() => {
    resetFindingStoreForTests();
  });

  function seeded(): { version: number } {
    const version = beginReview('p1');
    const base: AgentFinding = {
      type: 'SECURITY',
      severity: 'HIGH',
      category: 'AUTHORIZATION',
      title: 't',
      description: 'd',
      targetNodeId: null,
      status: 'OPEN',
      confidence: 1,
    };
    recordFinding({
      projectId: 'p1',
      runId: 'r',
      agentId: 'security-engineer',
      reviewVersion: version,
      finding: base,
    });
    recordFinding({
      projectId: 'p1',
      runId: 'r',
      agentId: 'dependency-engineer',
      reviewVersion: version,
      finding: { ...base, type: 'DEPENDENCY', severity: 'MEDIUM', category: 'UNUSED_DEPENDENCY' },
    });
    recordFinding({
      projectId: 'p1',
      runId: 'r',
      agentId: 'code-quality-engineer',
      reviewVersion: version,
      finding: { ...base, type: 'CODE_QUALITY', severity: 'MEDIUM', category: 'DUPLICATION' },
    });
    return { version };
  }

  it('counts the summary from the findings that exist', () => {
    const { version } = seeded();
    const summary = summarizeReview({
      reviewVersion: version,
      findings: findingsForReview('p1', version),
      agents: [
        { agentId: 'security-engineer', status: 'COMPLETED', findings: 1, error: null },
        { agentId: 'dependency-engineer', status: 'COMPLETED', findings: 1, error: null },
        { agentId: 'code-quality-engineer', status: 'COMPLETED', findings: 1, error: null },
      ],
      notes: [],
      generatedAt: '2026-08-27T00:00:00.000Z',
    });
    assert.equal(summary.totals.findings, 3);
    assert.equal(summary.status, 'COMPLETE');
    const security = summary.sections.find((section) => section.type === 'SECURITY');
    assert.equal(security?.counts.HIGH, 1);
    // 100 − 10 (high) − 4 − 4 (mediums)
    assert.equal(summary.score.score, 82);
    assert.equal(
      summary.score.totalDeducted,
      summary.score.deductions.reduce((sum, entry) => sum + entry.total, 0),
    );
  });

  it('reports PARTIAL_REVIEW when one reviewer failed, and says which', () => {
    const { version } = seeded();
    const summary = summarizeReview({
      reviewVersion: version,
      findings: findingsForReview('p1', version),
      agents: [
        { agentId: 'security-engineer', status: 'FAILED', findings: 0, error: 'timed out' },
        { agentId: 'dependency-engineer', status: 'COMPLETED', findings: 1, error: null },
        { agentId: 'code-quality-engineer', status: 'COMPLETED', findings: 1, error: null },
      ],
      notes: [],
      generatedAt: '2026-08-27T00:00:00.000Z',
    });
    assert.equal(summary.status, 'PARTIAL_REVIEW');
    assert.ok(summary.notes.some((note) => note.includes('security-engineer')));
  });

  it('excludes only FALSE_POSITIVE findings from the score', () => {
    const { version } = seeded();
    const findings = findingsForReview('p1', version);
    const high = findings.find((record) => record.severity === 'HIGH');
    assert.ok(high);

    setFindingStatus('p1', high.id, 'ACKNOWLEDGED');
    assert.equal(computeScore(listFindings('p1')).score, 82); // acknowledged still counts

    setFindingStatus('p1', high.id, 'FALSE_POSITIVE');
    assert.equal(computeScore(listFindings('p1')).score, 92); // false positive does not
  });
});

/* ── Graph integration (Steps 19, 26) ─────────────────────────────────── */

describe('findings in the graph', () => {
  const draft = buildGraph({
    requirements: REQUIREMENTS,
    architecture: ARCHITECTURE,
    design: DESIGN,
    backend: BACKEND,
    findings: [
      {
        id: 'abcd1234abcd1234',
        type: 'SECURITY',
        severity: 'HIGH',
        category: 'AUTHORIZATION',
        title: 'Missing ownership validation',
        description: 'd',
        status: 'OPEN',
        confidence: 0.9,
        agentId: 'security-engineer',
        targetFile: `backend/${BACKEND.modules[0]?.files[0] ?? ''}`,
        targetNodeId: null,
      },
      {
        id: 'ffff0000ffff0000',
        type: 'DEPENDENCY',
        severity: 'LOW',
        category: 'UNUSED_DEPENDENCY',
        title: 'Unused dependency "left-pad"',
        description: 'd',
        status: 'OPEN',
        confidence: 0.75,
        agentId: 'dependency-engineer',
        targetFile: 'backend/package.json',
        targetNodeId: null,
      },
      {
        id: '1111222233334444',
        type: 'CODE_QUALITY',
        severity: 'MEDIUM',
        category: 'DUPLICATION',
        title: 'Duplicated logic',
        description: 'd',
        status: 'OPEN',
        confidence: 1,
        agentId: 'code-quality-engineer',
        targetFile: 'nowhere/that/exists.ts',
        targetNodeId: null,
      },
    ],
  });

  it('creates one FINDING node per finding', () => {
    const findings = draft.nodes.filter((node) => node.type === 'FINDING');
    assert.equal(findings.length, 3);
  });

  const targetsFrom = (canonicalName: string) =>
    draft.edges.filter(
      (edge) => edge.relationship === 'TARGETS' && edge.from.canonicalName === canonicalName,
    );

  it('links a file finding to the file node it names', () => {
    const edges = targetsFrom('finding:abcd1234abcd1234');
    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.to.type, 'FILE');
  });

  it('never invents a link for a target the graph does not model', () => {
    // The third finding names a file that does not exist; it must be a
    // node with no TARGETS edge, not an edge to a guess.
    assert.ok(draft.nodes.some((node) => node.canonicalName === 'finding:1111222233334444'));
    assert.equal(targetsFrom('finding:1111222233334444').length, 0);
  });
});
