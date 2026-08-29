/**
 * Generation mesh tests (`npm test`).
 *
 * What is worth testing here is the part the generators do not already
 * cover. `generateBackend` and `generateFrontend` have their own suites and
 * are unchanged; running them again would be testing someone else's code.
 *
 * What is new in Phase 8 is the checking: the audits that compare emitted
 * output against the specs it claims to implement, the UX checks that read
 * real generated source, the improvements that must stay targeted, and the
 * manifest that must tell the truth about a second run. Each of those is a
 * claim this phase makes, so each gets a test that could fail.
 *
 * The fixtures are real generator output, not hand-written stubs. A UX
 * check that passes against a fixture someone wrote to make it pass has
 * tested nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { AGENT_DEFINITIONS, getAgentDefinition } from '../../shared/contracts/index.js';
import { buildPlan, computeWaves } from './lib/planner.js';
import { buildManifest, describeManifest } from './lib/generation-manifest.js';
import { CHECKED_CATEGORIES, passedCategories, runUxChecks } from './lib/ux-checks.js';
import { applyUxImprovements } from './lib/ux-improvements.js';
import { validateResult } from './lib/executor.js';
import type { AgentResult } from '../../shared/contracts/index.js';
import type { ProductSpec } from '../../shared/types/product.js';

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

/* ── The mesh's shape ─────────────────────────────────────────────────── */

describe('generation mesh declarations', () => {
  it('enables the three generation agents', () => {
    for (const id of ['backend-engineer', 'frontend-engineer', 'ux-ui-engineer'] as const) {
      const definition = getAgentDefinition(id);
      assert.ok(definition, `${id} is not declared`);
      assert.equal(definition.enabled, true, `${id} is declared but disabled`);
    }
  });

  it('still gives every artifact exactly one author', () => {
    const owners = new Map<string, string[]>();
    for (const definition of AGENT_DEFINITIONS) {
      for (const type of definition.produces) {
        owners.set(type, [...(owners.get(type) ?? []), definition.id]);
      }
    }
    for (const [type, producers] of owners) {
      assert.equal(producers.length, 1, `${type} has ${String(producers.length)} authors`);
    }
  });

  /**
   * The UX engineer edits the frontend rather than authoring it. Both
   * halves of that matter: it must be allowed to emit the artifact, and it
   * must not be counted as its author.
   */
  it('lets the UX engineer revise the frontend without claiming to have written it', () => {
    const ux = getAgentDefinition('ux-ui-engineer');
    assert.ok(ux);
    assert.ok(!ux.produces.includes('frontend-source'));
    assert.ok(ux.revises?.includes('frontend-source'));

    const result = {
      status: 'succeeded',
      artifacts: { 'ux-review': {}, 'ux-improvements': {}, 'frontend-source': {} },
    } as unknown as AgentResult;
    assert.equal(validateResult(ux, result).valid, true);
  });

  it('rejects an agent emitting an artifact it neither authors nor revises', () => {
    const backend = getAgentDefinition('backend-engineer');
    assert.ok(backend);
    const result = {
      status: 'succeeded',
      artifacts: {
        'backend-source': {},
        'backend-config': {},
        'backend-metadata': {},
        'frontend-source': {},
      },
    } as unknown as AgentResult;
    const validation = validateResult(backend, result);
    assert.equal(validation.valid, false);
    assert.match(validation.reason ?? '', /frontend-source/);
  });

  it('orders planning, then backend, then frontend, then review', () => {
    const plan = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      // Declared out of order on purpose: the DAG, not the array, decides.
      agentIds: [
        'ux-ui-engineer',
        'frontend-engineer',
        'requirement-analyst',
        'backend-engineer',
        'api-architect',
        'product-architect',
        'architecture-agent',
        'database-architect',
      ],
      priority: 'NORMAL',
    });
    const waves = computeWaves(plan.tasks);
    const taskAgent = new Map(plan.tasks.map((task) => [task.id, task.agentId]));
    const waveOf = (agentId: string): number =>
      waves.findIndex((wave) => wave.some((taskId) => taskAgent.get(taskId) === agentId));

    assert.ok(waveOf('backend-engineer') > waveOf('api-architect'));
    assert.ok(waveOf('frontend-engineer') > waveOf('backend-engineer'));
    assert.ok(waveOf('ux-ui-engineer') > waveOf('frontend-engineer'));
  });
});

/* ── What the generators actually produced ────────────────────────────── */

describe('generated output', () => {
  it('builds a backend whose modules follow the requirement, not a template', () => {
    const entities = BACKEND.modules.map((mod) => mod.entity).filter(Boolean);
    assert.ok(entities.length > 0);
    assert.ok(
      entities.some((entity) => /product/i.test(entity ?? '')),
      `expected an e-commerce entity, got ${entities.join(', ')}`,
    );
  });

  it('emits a frontend page for every implemented backend module', () => {
    const implemented = BACKEND.modules
      .filter((mod) => mod.crud)
      .map((mod) => mod.name.toLowerCase());
    const pages = FRONTEND.pages.map((page) => page.name.toLowerCase());
    for (const mod of implemented) {
      assert.ok(
        pages.some((page) => page.includes(mod) || mod.includes(page)),
        `no page for module ${mod}`,
      );
    }
  });
});

/* ── UX review ────────────────────────────────────────────────────────── */

describe('ux checks', () => {
  const findings = runUxChecks(FRONTEND.files, undefined);

  it('reports only problems it can point at a file for', () => {
    for (const finding of findings.filter((f) => f.observed && f.category !== 'NAVIGATION')) {
      assert.ok(finding.file, `${finding.category} finding has no file`);
      assert.ok(
        FRONTEND.files.some((file) => file.path === finding.file),
        `${finding.file} is not a generated file`,
      );
    }
  });

  /**
   * The check that earns the agent its place. The generator emits
   * `mutate(payload, { onSuccess })` with no failure branch, so a rejected
   * write leaves the screen silent — and this is the finding that says so.
   */
  it('finds writes whose failure the user would never see', () => {
    const silent = findings.filter(
      (finding) => finding.category === 'STATE' && finding.issue.includes('failure handling'),
    );
    assert.ok(silent.length > 0, 'expected unhandled mutation failures in the generated pages');
    assert.equal(silent[0]?.severity, 'HIGH');
  });

  it('does not invent problems the generator already solved', () => {
    // Every form the generator emits labels its fields; a review claiming
    // otherwise would be reporting on code it did not read.
    const labelFindings = findings.filter((finding) =>
      finding.issue.includes('no associated label'),
    );
    assert.equal(labelFindings.length, 0);
  });

  it('reports which dimensions came back clean', () => {
    const passed = passedCategories(findings);
    const failed = new Set(findings.map((finding) => finding.category));
    for (const category of passed) assert.ok(!failed.has(category));
    for (const category of CHECKED_CATEGORIES) {
      assert.ok(passed.includes(category) || failed.has(category), `${category} was neither`);
    }
  });

  it('flags a product module that no screen reaches', () => {
    const product: ProductSpec = {
      projectName: 'Shop',
      summary: 'A shop.',
      modules: [{ name: 'Refunds', purpose: 'Handle refunds', owns: [], dependsOn: [], roles: [] }],
      journeys: [],
      screens: [],
      businessRules: [],
      roles: [],
    };
    const withProduct = runUxChecks(FRONTEND.files, product);
    assert.ok(
      withProduct.some(
        (finding) => finding.category === 'NAVIGATION' && finding.target === 'Refunds',
      ),
    );
  });

  /**
   * The regression this check was rewritten for. A first version compared
   * module names to page filenames by substring and reported "Product
   * Catalog", "Order Management", "Payment Processing" and "Authentication"
   * as unreachable on a project where ProductsPage, OrdersPage,
   * PaymentsPage, LoginPage and RegisterPage all existed.
   */
  it('does not call a module missing because the product named it differently', () => {
    const product: ProductSpec = {
      projectName: 'Shop',
      summary: 'A shop.',
      modules: [
        { name: 'Product Catalog', purpose: '', owns: [], dependsOn: [], roles: [] },
        { name: 'Order Management', purpose: '', owns: [], dependsOn: [], roles: [] },
        { name: 'Payment Processing', purpose: '', owns: [], dependsOn: [], roles: [] },
        { name: 'Authentication', purpose: '', owns: [], dependsOn: [], roles: [] },
      ],
      journeys: [],
      // Authentication is delivered by screens that share none of its name.
      screens: [
        { name: 'Login', purpose: '', module: 'Authentication', roles: [] },
        { name: 'Register', purpose: '', module: 'Authentication', roles: [] },
      ],
      businessRules: [],
      roles: [],
    };
    const navigation = runUxChecks(FRONTEND.files, product).filter(
      (finding) => finding.category === 'NAVIGATION',
    );
    assert.deepEqual(
      navigation.map((finding) => finding.target),
      [],
      'reported a screen missing that the generator actually emitted',
    );
  });

  it('finds nothing to say about an empty file set rather than throwing', () => {
    assert.deepEqual(runUxChecks([], undefined), []);
  });
});

/* ── UX improvements ──────────────────────────────────────────────────── */

describe('ux improvements', () => {
  const { files, set } = applyUxImprovements(FRONTEND.files);

  it('fixes the silent-failure problem it reported', () => {
    const before = runUxChecks(FRONTEND.files, undefined).filter((finding) =>
      finding.issue.includes('failure handling'),
    );
    const after = runUxChecks(files, undefined).filter((finding) =>
      finding.issue.includes('failure handling'),
    );
    assert.ok(before.length > 0);
    assert.equal(after.length, 0, 'the improvement did not resolve the finding that motivated it');
  });

  it('leaves most of the frontend untouched', () => {
    // A UX pass that rewrote everything would be a regeneration. The
    // threshold is deliberately loose; the point is the order of magnitude.
    assert.ok(
      set.filesUnchanged > files.length / 2,
      `changed ${String(set.filesChanged.length)} of ${String(files.length)} files`,
    );
  });

  it('produces edits a person can audit', () => {
    assert.ok(set.improvements.length > 0);
    for (const improvement of set.improvements) {
      assert.notEqual(improvement.before, improvement.after);
      assert.ok(improvement.description.length > 0);
      assert.ok(files.some((file) => file.path === improvement.file));
    }
  });

  it('keeps the improved files valid where it can be checked cheaply', () => {
    for (const path of set.filesChanged) {
      const content = files.find((file) => file.path === path)?.content ?? '';
      const open = (content.match(/\{/g) ?? []).length;
      const close = (content.match(/\}/g) ?? []).length;
      assert.equal(open, close, `${path} has unbalanced braces after improvement`);
      if (content.includes('toast(')) {
        assert.ok(
          content.includes("from '@/shared/store/toast.store'"),
          `${path} calls toast without importing it`,
        );
      }
    }
  });

  /**
   * The regression a build caught and the tests did not.
   *
   * `<button ... ref={(el) => {…}} type="button">` contains a `>` inside an
   * arrow function. A regex lookahead stopped there, decided the tag had no
   * type, and added a second one — producing a file that was still
   * brace-balanced and no longer compiled: "JSX elements cannot have
   * multiple attributes with the same name".
   */
  it('does not add a type to a button that already has one further down the tag', () => {
    const source = {
      path: 'src/shared/components/ui/dropdown-menu.tsx',
      content: [
        'export function Menu() {',
        '  return (',
        '    <button',
        '      ref={(el) => {',
        '        register(el);',
        '      }}',
        '      role="menuitem"',
        '      type="button"',
        '      onClick={() => { select(); }}',
        '    >',
        '      Item',
        '    </button>',
        '  );',
        '}',
      ].join('\n'),
    };

    const result = applyUxImprovements([source]);
    const after = result.files[0]?.content ?? '';
    assert.equal(
      (after.match(/type="button"/g) ?? []).length,
      1,
      'added a duplicate type attribute',
    );
    assert.equal(result.set.improvements.length, 0);
  });

  it('still adds a type to a multi-line button that genuinely lacks one', () => {
    const source = {
      path: 'src/features/x/XPage.tsx',
      content: [
        '<button',
        '  onClick={() => { clear(); }}',
        '  className="x"',
        '>',
        '  Clear',
        '</button>',
      ].join('\n'),
    };
    const result = applyUxImprovements([source]);
    assert.equal((result.files[0]?.content.match(/type="button"/g) ?? []).length, 1);
  });

  it('is idempotent — a second pass finds nothing left to do', () => {
    const second = applyUxImprovements(files);
    assert.equal(second.set.improvements.length, 0);
  });
});

/* ── Generation manifest ──────────────────────────────────────────────── */

describe('generation manifest', () => {
  const files = [
    { path: 'src/a.ts', content: 'a' },
    { path: 'src/b.ts', content: 'b' },
  ];

  it('calls everything new on a first run', () => {
    const manifest = buildManifest(
      'p1',
      'r1',
      [{ agentId: 'backend-engineer', files, previous: [] }],
      '2026-01-01T00:00:00.000Z',
    );
    assert.equal(manifest.totals.created, 2);
    assert.equal(manifest.totals.updated, 0);
    assert.equal(manifest.totals.preserved, 0);
  });

  /**
   * The claim the manifest exists to make. A regeneration that changed one
   * file must say so, rather than reporting two files of work.
   */
  it('distinguishes what changed from what did not on a second run', () => {
    const manifest = buildManifest(
      'p1',
      'r2',
      [
        {
          agentId: 'backend-engineer',
          files: [
            { path: 'src/a.ts', content: 'a' },
            { path: 'src/b.ts', content: 'CHANGED' },
          ],
          previous: files,
        },
      ],
      '2026-01-02T00:00:00.000Z',
    );
    assert.equal(manifest.totals.preserved, 1);
    assert.equal(manifest.totals.updated, 1);
    assert.equal(manifest.totals.created, 0);
    assert.equal(describeManifest(manifest), '0 created · 1 updated · 1 preserved');
  });

  it('reports a dropped file without counting it as output', () => {
    const manifest = buildManifest(
      'p1',
      'r3',
      [{ agentId: 'backend-engineer', files: files.slice(0, 1), previous: files }],
      '2026-01-03T00:00:00.000Z',
    );
    assert.equal(manifest.totals.deleted, 1);
    assert.equal(manifest.totals.total, 1);
    assert.ok(manifest.changes.some((c) => c.path === 'src/b.ts' && c.operation === 'DELETE'));
  });

  it('attributes each file to the agent that emitted it', () => {
    const manifest = buildManifest(
      'p1',
      'r4',
      [
        { agentId: 'backend-engineer', files: files.slice(0, 1), previous: [] },
        { agentId: 'frontend-engineer', files: files.slice(1), previous: [] },
      ],
      '2026-01-04T00:00:00.000Z',
    );
    assert.equal(manifest.byArea.backend, 1);
    assert.equal(manifest.byArea.frontend, 1);
    assert.equal(manifest.byAgent['backend-engineer']?.created, 1);
  });

  it('does not double-count a path two agents both emit', () => {
    const manifest = buildManifest(
      'p1',
      'r5',
      [
        { agentId: 'backend-engineer', files: files.slice(0, 1), previous: [] },
        { agentId: 'frontend-engineer', files: files.slice(0, 1), previous: [] },
      ],
      '2026-01-05T00:00:00.000Z',
    );
    assert.equal(manifest.totals.total, 1);
  });
});
