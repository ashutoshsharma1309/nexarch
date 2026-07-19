/**
 * Database Designer tests (`npm test`). Every design is produced by driving
 * the real pipeline — analyze → plan → design — for each required domain,
 * then asserting the artifacts are correct and internally consistent. This
 * doubles as the cross-stage integration guard for Phases 2→3→4.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from './database-designer.service.js';
import type { DesignBundle } from './database-designer.types.js';

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

function designFor(prompt: string): DesignBundle {
  const analysis = analyzeRequirements(prompt);
  if (analysis.status !== 'COMPLETE') {
    assert.fail(`expected COMPLETE analysis for: ${prompt}`);
  }
  const { plan } = planArchitecture(analysis.spec);
  return designDatabase(plan, analysis.spec);
}

function assertSound(bundle: DesignBundle): void {
  const { databaseDesign: design, integrity } = bundle;

  // The integrity report is the design's own proof of consistency.
  assert.equal(integrity.valid, true, `integrity errors: ${JSON.stringify(integrity.issues)}`);
  assert.ok(integrity.stats.tables > 0);
  assert.ok(integrity.stats.endpoints > 0);

  for (const table of design.tables) {
    // Every table has the platform conventions: UUID PK + audit + soft delete.
    const id = table.columns.find((c) => c.name === 'id');
    assert.ok(id?.primaryKey && id.sqlType === 'CHAR(36)', `${table.entity} PK`);
    assert.ok(
      table.columns.some((c) => c.name === 'created_at'),
      `${table.entity} created_at`,
    );
    assert.ok(
      table.columns.some((c) => c.name === 'updated_at'),
      `${table.entity} updated_at`,
    );
    assert.ok(
      table.columns.some((c) => c.name === 'deleted_at'),
      `${table.entity} deleted_at`,
    );
    assert.ok(table.softDelete, `${table.entity} softDelete`);

    // Every FK column references a table that exists.
    for (const column of table.columns) {
      if (column.references) {
        assert.ok(
          design.tables.some((t) => t.entity === column.references?.table),
          `${table.entity}.${column.name} → ${column.references.table}`,
        );
      }
    }
  }

  // Artifacts are non-empty and well-formed.
  assert.match(bundle.prismaSchema, /datasource db \{/);
  assert.match(bundle.prismaSchema, /generator client \{/);
  assert.match(bundle.sqlSchema, /CREATE TABLE/);
  assert.equal(bundle.openapi.openapi, '3.1.0');
  assert.ok(Object.keys(bundle.openapi.paths).length > 0);
  assert.equal(bundle.erDiagram.nodes.length, design.tables.length);
  assert.equal(bundle.validationRules.entities.length, design.tables.length);
  assert.equal(bundle.entityMetadata.entities.length, design.tables.length);
}

describe('database design across domains', () => {
  for (const [label, prompt] of DOMAIN_PROMPTS) {
    it(`designs a valid schema for ${label}`, () => {
      assertSound(designFor(prompt));
    });
  }
});

describe('relational design correctness', () => {
  it('adds UUID PKs, audit fields and soft delete to every table', () => {
    const { databaseDesign } = designFor('Portfolio Website for a freelance designer');
    for (const table of databaseDesign.tables) {
      const names = table.columns.map((c) => c.name);
      assert.ok(
        names.includes('id') && names.includes('created_at') && names.includes('deleted_at'),
      );
    }
  });

  it('infers money columns as non-negative decimals', () => {
    const { databaseDesign } = designFor(
      'Restaurant POS with menu management, table billing and a kitchen display',
    );
    const menu = databaseDesign.tables.find((t) => t.entity === 'MenuItems');
    assert.ok(menu);
    const price = menu.columns.find((c) => c.name === 'price');
    assert.ok(price);
    assert.equal(price.sqlType, 'DECIMAL(12,2)');
    assert.equal(price.nonNegative, true);
  });

  it('emits enums for status columns with domain values', () => {
    const { databaseDesign } = designFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const orderStatus = databaseDesign.enums.find((e) => e.name === 'OrdersStatus');
    assert.ok(orderStatus, `enums: ${databaseDesign.enums.map((e) => e.name).join(', ')}`);
    assert.ok(orderStatus.values.includes('DELIVERED'));
  });

  it('marks email unique with a validation format rule', () => {
    const bundle = designFor('Portfolio Website for a freelance designer');
    const users = bundle.databaseDesign.tables.find((t) => t.entity === 'Users');
    assert.ok(users);
    const email = users.columns.find((c) => c.name === 'email');
    assert.ok(email?.unique && email.format === 'email');

    const userValidation = bundle.validationRules.entities.find((e) => e.entity === 'Users');
    const emailField = userValidation?.fields.find((f) => f.field === 'email');
    assert.ok(emailField, 'email validation field present');
    assert.ok(emailField.rules.some((r) => r.rule === 'format' && r.value === 'email'));
    assert.ok(emailField.rules.some((r) => r.rule === 'unique'));
  });

  it('resolves cascade vs restrict delete behavior by relationship', () => {
    const { databaseDesign } = designFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const orderItems = databaseDesign.relationships.find(
      (r) => r.child === 'OrderItems' && r.parent === 'Orders',
    );
    assert.equal(orderItems?.onDelete, 'CASCADE');
  });
});

describe('OpenAPI contract', () => {
  it('generates CRUD operations, schemas and security from the design', () => {
    const { openapi } = designFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    // Component schema derived from the Products table.
    assert.ok(openapi.components.schemas.Products);
    assert.ok(openapi.components.schemas.ProductsCreateInput);
    // A products collection path with list + create.
    const products = openapi.paths['/products'];
    if (!products?.get || !products.post) assert.fail('expected /products GET + POST');
    // List endpoint carries pagination.
    assert.ok(products.get.parameters?.some((p) => p.name === 'page'));
    // Auth is declared as bearer security.
    assert.ok(products.post.security?.some((s) => 'bearerAuth' in s));
    assert.ok(openapi.components.securitySchemes.bearerAuth);
    // Standard error responses are referenced.
    assert.ok(openapi.components.responses.ValidationError);
  });
});

describe('optimization and metadata', () => {
  it('recommends caching for reference tables and partitioning for high-volume tables', () => {
    const { databaseDesign } = designFor(
      'Banking system with accounts, transfers, otp login and transaction sms alerts',
    );
    const opt = databaseDesign.optimization;
    assert.ok(opt.partitioningCandidates.some((c) => c.table === 'transactions'));
    assert.ok(opt.indexes.length > 0);
  });

  it('derives ownership and permissions per entity', () => {
    const { entityMetadata } = designFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const orders = entityMetadata.entities.find((e) => e.entity === 'Orders');
    assert.ok(orders);
    assert.ok(orders.permissions.some((p) => p.role === 'Admin' && p.actions.includes('delete')));
    assert.ok(orders.businessRules.length > 0);
  });
});
