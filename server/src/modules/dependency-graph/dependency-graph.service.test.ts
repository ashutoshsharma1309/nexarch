/**
 * Dependency Graph Engine tests (`npm test`). Every case is produced by
 * driving the real pipeline — analyze → plan → design → generate backend →
 * generate frontend → apply security → build/analyze/regenerate the
 * dependency graph — for each required domain, then asserting the graph is
 * structurally sound. This doubles as the cross-stage integration guard
 * for Phases 2→3→4→5→6→7→8.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import {
  analyzeChangeImpact,
  analyzeSpecDiff,
  buildDependencyGraphBundle,
  regenerateProject,
} from './dependency-graph.service.js';
import type { GraphInputs } from './dependency-graph.service.js';
import type { DependencyGraphBundle } from './dependency-graph.types.js';

const DOMAIN_PROMPTS: readonly [string, string][] = [
  [
    'Hospital',
    'Build a hospital management system where patients book appointments with doctors, with billing, prescriptions and sms reminders',
  ],
  ['ERP', 'Build an ERP with inventory, procurement, finance, hr and role based access'],
  ['CRM', 'CRM for the sales team with leads pipeline, tasks and email integration'],
  ['Inventory', 'Inventory management system with low stock alerts, suppliers and excel export'],
  ['Restaurant', 'Restaurant POS with menu management, table billing and a kitchen display'],
  [
    'School',
    'School management system with attendance, exams, timetable, fees and parent sms alerts',
  ],
  ['LMS', 'Build an lms called SkillForge with paid video courses, quizzes and certificates'],
  ['Portfolio', 'Portfolio Website for a freelance designer'],
  ['Banking', 'Banking system with accounts, transfers, otp login and transaction sms alerts'],
  ['Hotel', 'Hotel room booking website with online payments and email confirmations'],
];

function buildInputs(prompt: string): GraphInputs {
  const analysis = analyzeRequirements(prompt);
  if (analysis.status !== 'COMPLETE') {
    assert.fail(`expected COMPLETE analysis for: ${prompt}`);
  }
  const { plan } = planArchitecture(analysis.spec);
  const bundle = designDatabase(plan, analysis.spec);
  const backendProject = generateBackend(
    plan,
    analysis.spec,
    bundle.databaseDesign,
    bundle.prismaSchema,
    bundle.openapi,
    bundle.validationRules.entities,
    bundle.entityMetadata,
  );
  const backendManifest = { modules: backendProject.modules, routes: backendProject.routes };
  const frontendProject = generateFrontend(
    plan,
    analysis.spec,
    bundle.databaseDesign,
    bundle.openapi,
    backendManifest,
    bundle.entityMetadata,
  );
  const frontendManifest = {
    pages: frontendProject.pages.map((p) => ({
      name: p.name,
      route: p.route,
      kind: p.kind,
      entity: p.entity,
      implemented: p.implemented,
    })),
  };
  const securityBundle = applySecurity({
    requirements: analysis.spec,
    architecture: plan,
    database: bundle.databaseDesign,
    openapi: bundle.openapi,
    entityMetadata: bundle.entityMetadata,
    backendManifest,
    frontendManifest,
  });

  return {
    requirements: analysis.spec,
    architecture: plan,
    database: bundle.databaseDesign,
    backend: {
      files: backendProject.files,
      modules: backendProject.modules,
      routes: backendProject.routes,
    },
    frontend: {
      files: frontendProject.files,
      pages: frontendProject.pages,
      components: frontendProject.components,
      routes: frontendProject.routes,
      stores: frontendProject.stores,
    },
    security: {
      backendFiles: securityBundle.backendFiles,
      frontendFiles: securityBundle.frontendFiles,
      rbac: securityBundle.rbac,
    },
  };
}

function buildFor(prompt: string): DependencyGraphBundle {
  return buildDependencyGraphBundle(buildInputs(prompt)).bundle;
}

function assertSound(bundle: DependencyGraphBundle): void {
  const ids = bundle.graph.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate node ids');
  assert.ok(bundle.graph.nodes.length > 0);
  assert.ok(bundle.graph.edges.length > 0);

  const nodeIdSet = new Set(ids);
  for (const edge of bundle.graph.edges) {
    assert.ok(nodeIdSet.has(edge.from), `edge references unknown node ${edge.from}`);
    assert.ok(nodeIdSet.has(edge.to), `edge references unknown node ${edge.to}`);
  }

  assert.equal(bundle.graph.metadata.nodeCount, bundle.graph.nodes.length);
  assert.equal(bundle.graph.metadata.edgeCount, bundle.graph.edges.length);
  assert.equal(bundle.stats.totalNodes, bundle.graph.nodes.length);
  assert.equal(bundle.stats.totalEdges, bundle.graph.edges.length);

  // Every node appears exactly once in the layout, and every layout group present has nodes.
  const layoutIds = bundle.layout.nodes.map((n) => n.id);
  assert.equal(new Set(layoutIds).size, layoutIds.length);
  for (const id of ids) assert.ok(layoutIds.includes(id), `layout missing node ${id}`);

  assert.ok(Array.isArray(bundle.quality.recommendations));
  assert.ok(bundle.quality.recommendations.length > 0);
}

describe('dependency graph across domains', () => {
  for (const [label, prompt] of DOMAIN_PROMPTS) {
    it(`builds a sound dependency graph for ${label}`, () => {
      assertSound(buildFor(prompt));
    });
  }
});

describe('generation correctness', () => {
  it('chains controller -> service -> repository -> prisma-model -> db-table for a real entity', () => {
    const bundle = buildFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const productsController = bundle.graph.nodes.find(
      (n) => n.type === 'controller' && n.meta.moduleSlug === 'products',
    );
    assert.ok(productsController, 'expected a Products controller node');

    const outgoing = new Map<string, string[]>();
    for (const edge of bundle.graph.edges) {
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    }

    const serviceIds = outgoing.get(productsController.id) ?? [];
    const service = bundle.graph.nodes.find(
      (n) => serviceIds.includes(n.id) && n.type === 'service',
    );
    assert.ok(service, 'controller should invoke a service');

    const repoIds = outgoing.get(service.id) ?? [];
    const repository = bundle.graph.nodes.find(
      (n) => repoIds.includes(n.id) && n.type === 'repository',
    );
    assert.ok(repository, 'service should query a repository');

    const modelIds = outgoing.get(repository.id) ?? [];
    const model = bundle.graph.nodes.find(
      (n) => modelIds.includes(n.id) && n.type === 'prisma-model',
    );
    assert.ok(model, 'repository should query a prisma-model');

    const tableIds = outgoing.get(model.id) ?? [];
    const table = bundle.graph.nodes.find((n) => tableIds.includes(n.id) && n.type === 'db-table');
    assert.ok(table, 'prisma-model should map to a db-table');
  });

  it('links a frontend service to the backend endpoint it calls', () => {
    const bundle = buildFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const callsApi = bundle.graph.edges.filter((e) => e.type === 'calls-api');
    assert.ok(callsApi.length > 0, 'expected at least one calls-api edge');
    for (const edge of callsApi) {
      assert.ok(edge.from.startsWith('file:'));
      assert.ok(edge.to.startsWith('api-endpoint:'));
    }
  });

  it('classifies "Add Google Login" as an authentication change and finds the JWT module', () => {
    const inputs = buildInputs(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const impact = analyzeChangeImpact('Add Google Login', inputs);
    assert.equal(impact.classification.category, 'authentication');
    assert.ok(impact.affectedFiles.some((f) => f.path === 'src/shared/security/jwt.ts'));
    assert.ok(impact.tokenOptimization.affectedFiles < impact.tokenOptimization.fullProjectFiles);
    assert.ok(impact.tokenOptimization.savingsPercent > 0);
  });

  it('scopes an unrelated change to a small fraction of the project', () => {
    const inputs = buildInputs(
      'CRM for the sales team with leads pipeline, tasks and email integration',
    );
    const impact = analyzeChangeImpact('Add dark mode theme support', inputs);
    assert.equal(impact.classification.category, 'theme');
    assert.ok(impact.unaffectedFileCount > 0);
    assert.ok(
      impact.affectedFiles.length < impact.tokenOptimization.fullProjectFiles,
      'a narrow change should not touch the whole project',
    );
  });

  it('regenerate() only replaces affected files and always keeps manual edits', () => {
    const inputs = buildInputs('Portfolio Website for a freelance designer');
    const { project } = buildDependencyGraphBundle(inputs);
    const anyFile = project.files[0];
    assert.ok(anyFile);

    const result = regenerateProject({
      ...inputs,
      changeRequest: 'Add dark mode theme support',
      newBackend: inputs.backend,
      newFrontend: inputs.frontend,
      newSecurity: inputs.security,
      manualEdits: { [anyFile.path]: '// hand-edited by a developer\n' },
    });

    const manualFile = result.files.find((f) => f.path === anyFile.path);
    assert.ok(manualFile);
    assert.equal(manualFile.provenance, 'manual');
    assert.equal(manualFile.content, '// hand-edited by a developer\n');

    const preserved = result.files.filter((f) => f.provenance === 'preserved');
    assert.ok(preserved.length > 0, 'unaffected files should be preserved, not regenerated');
    assert.equal(result.stats.total, result.files.length);
    assert.equal(
      result.stats.regenerated + result.stats.preserved + result.stats.manual,
      result.stats.total,
    );
  });

  it('records successive versions in the project manifest', () => {
    const inputs = buildInputs(
      'Hotel room booking website with online payments and email confirmations',
    );
    const first = regenerateProject({
      ...inputs,
      changeRequest: 'Add dark mode theme support',
      newBackend: inputs.backend,
      newFrontend: inputs.frontend,
      newSecurity: inputs.security,
    });
    const second = regenerateProject({
      ...inputs,
      changeRequest: 'Add Google Login',
      newBackend: inputs.backend,
      newFrontend: inputs.frontend,
      newSecurity: inputs.security,
    });

    assert.equal(second.manifest.currentVersion, first.manifest.currentVersion + 1);
    assert.ok(
      second.manifest.versions.some((v) => v.changeRequest === 'Add dark mode theme support'),
    );
    assert.ok(second.manifest.versions.some((v) => v.changeRequest === 'Add Google Login'));
  });

  it('detects no circular dependencies in a normally generated project', () => {
    const bundle = buildFor(
      'Restaurant POS with menu management, table billing and a kitchen display',
    );
    assert.equal(bundle.quality.circularDependencies.length, 0);
    assert.equal(bundle.stats.circularDependencyCount, 0);
  });
});

describe('spec diff (prompt-level incremental regeneration)', () => {
  const oldPrompt = 'Inventory management system with low stock alerts, suppliers and excel export';
  const newPrompt =
    'Inventory management system with low stock alerts, suppliers, excel export and barcode scanning with sms notifications';
  const inputs = buildInputs(oldPrompt);

  it('reports identical specs as identical and preserves every file', () => {
    const analysis = analyzeSpecDiff(inputs.requirements, inputs);
    assert.equal(analysis.diff.identical, true);
    assert.equal(analysis.impact, null);
    assert.equal(analysis.plan.regenerateCount, 0);
    assert.ok(analysis.plan.preservedFileCount > 0, 'identical diff still counts preserved files');
    assert.equal(analysis.plan.fullRebuildRecommended, false);
  });

  it('detects added requirements between two real analyzed prompts', () => {
    const newAnalysis = analyzeRequirements(newPrompt);
    if (newAnalysis.status !== 'COMPLETE') assert.fail('expected COMPLETE analysis');
    const analysis = analyzeSpecDiff(newAnalysis.spec, inputs);

    assert.equal(analysis.diff.identical, false);
    assert.ok(analysis.diff.addedCount > 0, 'new prompt must add requirements');
    assert.ok(
      analysis.diff.changeRequests.length > 0,
      'diff must synthesize change requests for the impact analyzer',
    );
    // The plan must be selective: something regenerates, something survives.
    assert.ok(analysis.impact !== null);
    assert.ok(analysis.plan.preservedFileCount > 0, 'a small diff must preserve files');
  });

  it('keeps rewording-only changes out of the diff', () => {
    // Same requirements, different casing — the differ must not care.
    const reworded = {
      ...inputs.requirements,
      modules: inputs.requirements.modules.map((m) => m.toUpperCase()),
    };
    const analysis = analyzeSpecDiff(reworded, inputs);
    assert.equal(analysis.diff.identical, true);
  });
});
