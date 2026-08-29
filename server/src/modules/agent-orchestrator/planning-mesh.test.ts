/**
 * Planning mesh tests (`npm test`).
 *
 * Three things are worth testing here and the rest is covered elsewhere:
 * the deterministic consistency checks (whose whole value is catching
 * something no single agent can see), the artifact store's versioning and
 * provenance, and the normalizers that stand between model output and
 * everything downstream.
 *
 * The mesh's execution — dependencies, retries, timeouts — is the Phase 6
 * runtime and is tested against that. Running five real agents here would
 * test the model, not the code.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateOpenApi } from '../database-designer/lib/openapi-generator.js';
import { AGENT_DEFINITIONS, getAgentDefinition } from '../../shared/contracts/index.js';
import { checkConsistency } from './lib/consistency.js';
import { deriveProductSpec } from './lib/product-fallback.js';
import { mergeRequirementDetail, normalizeProductSpec } from './lib/spec-normalizers.js';
import {
  artifactHistory,
  latestArtifact,
  resetArtifactStoreForTests,
  traceLineage,
  writeArtifact,
} from './lib/artifact-store.js';
import { buildPlan } from './lib/planner.js';
import type { DatabaseDesign, OpenApiDocument } from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

/* ── Fixture: a real student-management project ───────────────────────── */

const analysis = analyzeRequirements(
  'Build a student management SaaS with authentication, student profiles, courses, attendance, grades and reports.',
);
assert.equal(analysis.status, 'COMPLETE');
const REQUIREMENTS: RequirementSpec = analysis.spec;
const ARCHITECTURE = planArchitecture(REQUIREMENTS).plan;
const DESIGN = designDatabase(ARCHITECTURE, REQUIREMENTS);
const DATABASE: DatabaseDesign = DESIGN.databaseDesign;
const API: OpenApiDocument = generateOpenApi(ARCHITECTURE, DATABASE);

/* ── The mesh's shape ─────────────────────────────────────────────────── */

describe('planning mesh declarations', () => {
  it('declares all five planning agents as enabled', () => {
    for (const id of [
      'requirement-analyst',
      'product-architect',
      'architecture-agent',
      'database-architect',
      'api-architect',
    ] as const) {
      const definition = getAgentDefinition(id);
      assert.ok(definition, `${id} is not declared`);
      assert.equal(definition.enabled, true, `${id} should be enabled`);
    }
  });

  it('gives the API architect both of its real dependencies', () => {
    const api = getAgentDefinition('api-architect');
    assert.ok(api);
    // An API designed without the schema names entities that do not exist.
    assert.deepEqual(api.dependencies, ['architecture-agent', 'database-architect']);
    assert.deepEqual(api.requires, ['architecture-plan', 'database-design']);
  });

  it('gives every artifact exactly one producer', () => {
    const owners = new Map<string, string[]>();
    for (const definition of AGENT_DEFINITIONS) {
      for (const type of definition.produces) {
        owners.set(type, [...(owners.get(type) ?? []), definition.id]);
      }
    }
    for (const [type, producers] of owners) {
      assert.equal(producers.length, 1, `${type} has ${String(producers.length)} producers`);
    }
  });

  it('orders the mesh so each agent runs after what it needs', () => {
    const plan = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      agentIds: [
        'api-architect',
        'requirement-analyst',
        'database-architect',
        'product-architect',
        'architecture-agent',
      ],
      priority: 'NORMAL',
    });
    // Declared out of order on purpose: the DAG, not the array, decides.
    const order = plan.waves.flat().map((id) => {
      const task = plan.tasks.find((entry) => entry.id === id);
      return task?.agentId;
    });
    assert.deepEqual(order, [
      'requirement-analyst',
      'product-architect',
      'architecture-agent',
      'database-architect',
      'api-architect',
    ]);
  });
});

/* ── Consistency ──────────────────────────────────────────────────────── */

describe('cross-agent consistency', () => {
  it('passes a coherent plan with no mismatches', () => {
    const findings = checkConsistency({
      requirements: REQUIREMENTS,
      architecture: ARCHITECTURE,
      database: DATABASE,
      api: API,
    });
    const mismatches = findings.filter((finding) => finding.category.endsWith('_MISMATCH'));
    assert.deepEqual(
      mismatches.map((finding) => finding.category),
      [],
      `unexpected: ${mismatches.map((f) => f.description).join(' | ')}`,
    );
  });

  it('detects an API that references an entity the schema does not define', () => {
    // The mismatch that produces a runtime 500 rather than a design debate.
    const brokenApi: OpenApiDocument = {
      ...API,
      paths: { ...API.paths, '/api/v1/invoices': API.paths[Object.keys(API.paths)[0] ?? ''] ?? {} },
    };
    const findings = checkConsistency({ database: DATABASE, api: brokenApi });
    const mismatch = findings.find((finding) => finding.category === 'API_DATABASE_MISMATCH');
    assert.ok(mismatch, 'an unknown entity must be flagged');
    assert.match(mismatch.description, /invoice/i);
    assert.equal(mismatch.severity, 'HIGH');
  });

  it('detects a table the architecture never planned', () => {
    const strayTable = DATABASE.tables[0];
    assert.ok(strayTable);
    const broken: DatabaseDesign = {
      ...DATABASE,
      tables: [...DATABASE.tables, { ...strayTable, entity: 'Invoices', tableName: 'invoices' }],
    };
    const findings = checkConsistency({ architecture: ARCHITECTURE, database: broken });
    const mismatch = findings.find(
      (finding) => finding.category === 'DATABASE_ARCHITECTURE_MISMATCH',
    );
    assert.ok(mismatch);
    assert.match(mismatch.description, /Invoices/);
  });

  it('detects a requirement nothing implements', () => {
    const findings = checkConsistency({
      requirements: { ...REQUIREMENTS, modules: [...REQUIREMENTS.modules, 'Payroll'] },
      architecture: ARCHITECTURE,
    });
    const mismatch = findings.find(
      (finding) => finding.category === 'REQUIREMENT_ARCHITECTURE_MISMATCH',
    );
    assert.ok(mismatch);
    assert.match(mismatch.description, /Payroll/);
  });

  it('detects a product module with no architectural component', () => {
    const product = deriveProductSpec({ ...REQUIREMENTS, modules: ['Payroll'] });
    const findings = checkConsistency({ product, architecture: ARCHITECTURE });
    assert.ok(findings.some((f) => f.category === 'PRODUCT_ARCHITECTURE_MISMATCH'));
  });

  it('is deterministic and never calls a model', () => {
    const once = checkConsistency({ requirements: REQUIREMENTS, architecture: ARCHITECTURE });
    const twice = checkConsistency({ requirements: REQUIREMENTS, architecture: ARCHITECTURE });
    assert.deepEqual(once, twice);
  });

  it('checks only what it was given', () => {
    assert.deepEqual(checkConsistency({}), []);
  });
});

/* ── Artifacts: versioning and provenance ─────────────────────────────── */

describe('artifact store', () => {
  beforeEach(() => {
    resetArtifactStoreForTests();
  });

  const write = (type: 'requirement-spec' | 'architecture-plan', derivedFrom: string[] = []) =>
    writeArtifact({
      projectId: 'p1',
      runId: 'r1',
      type,
      agentId: type === 'requirement-spec' ? 'requirement-analyst' : 'architecture-agent',
      agentVersion: '1.0.0',
      derivedFrom,
      content: { type },
    });

  it('versions rather than overwrites', () => {
    assert.equal(write('architecture-plan').version, 1);
    assert.equal(write('architecture-plan').version, 2);
    // v1 is still there: the record of what was decided before survives.
    assert.equal(artifactHistory('p1', 'architecture-plan').length, 2);
    assert.equal(latestArtifact('p1', 'architecture-plan')?.version, 2);
  });

  it('versions each type independently', () => {
    write('architecture-plan');
    write('architecture-plan');
    assert.equal(write('requirement-spec').version, 1);
  });

  it('records who produced an artifact and what from', () => {
    const spec = write('requirement-spec');
    const plan = write('architecture-plan', [spec.id]);
    assert.equal(plan.agentId, 'architecture-agent');
    assert.deepEqual(plan.derivedFrom, [spec.id]);
  });

  it('traces a decision back to its inputs', () => {
    const spec = write('requirement-spec');
    const plan = write('architecture-plan', [spec.id]);
    const lineage = traceLineage(plan.id);
    assert.deepEqual(
      lineage.map((record) => record.type),
      ['requirement-spec'],
    );
    // The artifact itself is not part of its own lineage.
    assert.ok(!lineage.some((record) => record.id === plan.id));
  });

  it('returns an empty lineage for an unknown artifact rather than throwing', () => {
    assert.deepEqual(traceLineage('nope'), []);
  });
});

/* ── Normalizers ──────────────────────────────────────────────────────── */

describe('spec normalizers', () => {
  it('coerces a comma-separated string into the list it should have been', () => {
    const product = normalizeProductSpec(
      { summary: 'x', modules: [{ name: 'Courses', owns: 'Course, Enrollment' }] },
      REQUIREMENTS,
    );
    assert.deepEqual(product.modules[0]?.owns, ['Course', 'Enrollment']);
  });

  it('drops entries too malformed to use instead of inventing content', () => {
    const product = normalizeProductSpec(
      { modules: [{ name: 'Courses' }, { purpose: 'nameless' }, 'not an object'] },
      REQUIREMENTS,
    );
    assert.equal(product.modules.length, 1);
    assert.equal(product.modules[0]?.name, 'Courses');
  });

  it('survives output that is not an object at all', () => {
    const product = normalizeProductSpec('nonsense', REQUIREMENTS);
    assert.equal(product.modules.length, 0);
    assert.equal(product.projectName, REQUIREMENTS.projectName);
  });

  it('merges planning detail without disturbing the legacy fields', () => {
    const merged = mergeRequirementDetail(REQUIREMENTS, {
      goal: 'Run a school',
      functionalRequirements: ['A teacher records attendance'],
      acceptanceCriteria: ['Attendance is visible to admins'],
    });
    assert.equal(merged.goal, 'Run a school');
    assert.deepEqual(merged.functionalRequirements, ['A teacher records attendance']);
    // The deterministic pipeline reads these and must see them unchanged.
    assert.deepEqual(merged.modules, REQUIREMENTS.modules);
    assert.deepEqual(merged.database, REQUIREMENTS.database);
  });

  it('leaves an unanalyzed field absent rather than empty', () => {
    // Empty reads as "none exist", which is a different claim from
    // "not analyzed" — and the difference matters to a reviewer.
    const merged = mergeRequirementDetail(REQUIREMENTS, {});
    assert.equal(merged.goal, undefined);
    assert.equal(merged.constraints, undefined);
  });
});

/* ── Product fallback ─────────────────────────────────────────────────── */

describe('product fallback', () => {
  it('derives a structurally complete spec without a model', () => {
    const product = deriveProductSpec(REQUIREMENTS);
    assert.equal(product.modules.length, REQUIREMENTS.modules.length);
    assert.ok(product.journeys.length > 0);
    assert.ok(product.screens.length > 0);
  });

  it('invents no business rules', () => {
    // A rule nobody stated is a rule fabricated; the agent flags the
    // degradation instead.
    assert.deepEqual(deriveProductSpec(REQUIREMENTS).businessRules, []);
  });

  it('only references modules that exist', () => {
    const product = deriveProductSpec(REQUIREMENTS);
    const names = new Set(product.modules.map((module) => module.name));
    for (const module of product.modules) {
      assert.ok(module.dependsOn.every((name) => names.has(name)));
    }
  });
});
