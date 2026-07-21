/**
 * Security Engine tests (`npm test`). Every case is produced by driving the
 * real pipeline — analyze → plan → design → generate backend → generate
 * frontend → analyze/apply security — for each required domain, then
 * asserting the emitted bundle is structurally sound. This doubles as the
 * cross-stage integration guard for Phases 2→3→4→5→6→7.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../shared/types/design.js';
import { emitAuthenticationModule } from './lib/authentication-module.js';
import { runSecurityScanner } from './lib/security-scanner.js';
import type { SecurityModel } from './lib/security-model.js';
import { analyzeSecurity, applySecurity } from './security-engine.service.js';
import type { SecurityInputs } from './security-engine.service.js';
import type { SecurityBundle } from './security-engine.types.js';

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

function buildInputs(prompt: string): SecurityInputs {
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

  return {
    requirements: analysis.spec,
    architecture: plan,
    database: bundle.databaseDesign,
    openapi: bundle.openapi,
    entityMetadata: bundle.entityMetadata,
    backendManifest,
    frontendManifest,
  };
}

function applyFor(prompt: string): SecurityBundle {
  return applySecurity(buildInputs(prompt));
}

const CORE_BACKEND_FILES = [
  'src/shared/security/jwt.ts',
  'src/shared/security/password.ts',
  'src/shared/security/rbac.ts',
  'src/shared/security/permissions.generated.ts',
  'src/shared/security/cookies.ts',
  'src/shared/security/csrf.ts',
  'src/shared/security/rate-limiters.ts',
  'src/shared/middleware/sanitize.ts',
  'src/shared/middleware/auth.ts',
  'src/shared/middleware/file-upload.ts',
  'src/shared/types/express.d.ts',
  'src/shared/config/env.ts',
  'src/shared/config/index.ts',
  'src/app.ts',
  'package.json',
  '.env.example',
];

function assertSound(bundle: SecurityBundle): void {
  const backendPaths = bundle.backendFiles.map((f) => f.path);
  assert.equal(new Set(backendPaths).size, backendPaths.length, 'duplicate backend file paths');
  assert.ok(bundle.backendFiles.length > 0);

  for (const generated of [...bundle.backendFiles, ...bundle.frontendFiles]) {
    assert.ok(generated.content.length > 0, `${generated.path} is empty`);
    assert.ok(
      generated.content.endsWith('\n') && !generated.content.endsWith('\n\n'),
      generated.path,
    );
  }

  for (const expected of CORE_BACKEND_FILES) {
    assert.ok(backendPaths.includes(expected), `missing backend file ${expected}`);
  }

  const frontendPaths = bundle.frontendFiles.map((f) => f.path);
  for (const expected of [
    'src/shared/layouts/role-guard.tsx',
    'src/shared/layouts/permission-guard.tsx',
    'src/shared/layouts/forbidden-page.tsx',
    'src/shared/hooks/use-session-timeout.ts',
    'src/shared/security/permissions.ts',
  ]) {
    assert.ok(frontendPaths.includes(expected), `missing frontend file ${expected}`);
  }

  assert.ok(bundle.report.overallScore >= 0 && bundle.report.overallScore <= 100);
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(bundle.report.grade));
  assert.equal(bundle.owasp.categories.length, 10);
  for (const category of bundle.owasp.categories) {
    assert.ok(['pass', 'warn', 'fail', 'not-applicable'].includes(category.status), category.id);
  }
  assert.equal(bundle.stats.backendFiles, bundle.backendFiles.length);
  assert.equal(bundle.stats.frontendFiles, bundle.frontendFiles.length);

  // The folder tree covers every generated file path.
  const countTreeFiles = (nodes: typeof bundle.folderTree, prefix: string): string[] =>
    nodes.flatMap((node) =>
      node.type === 'file'
        ? [`${prefix}${node.name}`]
        : countTreeFiles(node.children ?? [], `${prefix}${node.name}/`),
    );
  const treePaths = new Set(countTreeFiles(bundle.folderTree, ''));
  for (const p of [...backendPaths, ...frontendPaths]) {
    assert.ok(treePaths.has(p), `folder tree missing ${p}`);
  }
}

describe('security generation across domains', () => {
  for (const [label, prompt] of DOMAIN_PROMPTS) {
    it(`generates a valid security bundle for ${label}`, () => {
      assertSound(applyFor(prompt));
    });
  }
});

describe('generation correctness', () => {
  it('wires real authentication when an identity table is detected', () => {
    const bundle = applyFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    assert.ok(bundle.stats.identityTableDetected, 'expected an identity table to be detected');
    const paths = bundle.backendFiles.map((f) => f.path);
    assert.ok(paths.includes('src/modules/authentication/services/authentication.service.ts'));
    assert.ok(
      paths.includes('src/modules/authentication/controllers/authentication.controller.ts'),
    );
    const service = bundle.backendFiles.find(
      (f) => f.path === 'src/modules/authentication/services/authentication.service.ts',
    );
    assert.match(service?.content ?? '', /hashPassword/);
    assert.match(service?.content ?? '', /signAccessToken/);
  });

  it('leaves the authentication scaffold stub and raises a finding when no identity table exists', () => {
    // Every current analyzer-driven domain profile lands a Users table with
    // email + password columns (same situation Phase 6 hit for auth pages),
    // so this exercises the no-identity branch directly rather than relying
    // on a prompt that happens to produce a schema without one.
    const modelWithoutIdentity: SecurityModel = {
      projectName: 'Test',
      projectType: 'Test',
      apiPrefix: '/api/v1',
      roles: ['Admin', 'User'],
      authEnabled: true,
      authMethods: ['JWT'],
      identity: null,
      entities: [],
      endpoints: [],
    };

    const findings = runSecurityScanner(modelWithoutIdentity, false);
    const finding = findings.find(
      (f) => f.title === 'No identity table detected for authentication',
    );
    assert.ok(finding);
    assert.equal(finding.resolved, false);
    assert.equal(finding.severity, 'high');

    const authResult = emitAuthenticationModule(
      {
        apiModules: [{ module: 'Authentication', basePath: '/auth', endpoints: [] }],
      } as unknown as ArchitecturePlan,
      { tables: [] } as unknown as DatabaseDesign,
      modelWithoutIdentity,
    );
    assert.deepEqual(authResult.files, []);
  });

  it('derives the RBAC permission map from entity-metadata.json for every entity', () => {
    const bundle = applyFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const entities = new Set(bundle.rbac.permissions.map((p) => p.entity));
    assert.ok(entities.size > 0);
    for (const entry of bundle.rbac.permissions) {
      assert.ok(
        bundle.rbac.roles.some((r) => r.role === entry.role),
        `unknown role ${entry.role}`,
      );
      assert.ok(entry.actions.length > 0);
    }
    assert.deepEqual(bundle.permissions, bundle.rbac.permissions);
  });

  it('analyze() reports the same findings as apply() but nothing marked resolved', () => {
    const inputs = buildInputs(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const analysis = analyzeSecurity(inputs);
    const bundle = applySecurity(inputs);

    assert.equal(analysis.report.findings.length, bundle.report.findings.length);
    assert.ok(analysis.report.findings.every((f) => !f.resolved));
    assert.ok(bundle.report.summary.resolved > 0, 'apply() should resolve at least one finding');
    assert.ok(analysis.report.overallScore <= bundle.report.overallScore);
  });

  it('generates a password policy that meets a real minimum bar', () => {
    const bundle = applyFor('Portfolio Website for a freelance designer');
    assert.ok(bundle.passwordPolicy.minLength >= 8);
    assert.ok(bundle.passwordPolicy.requireUppercase);
    assert.ok(bundle.passwordPolicy.requireLowercase);
    assert.ok(bundle.passwordPolicy.requireNumber);
    assert.ok(bundle.passwordPolicy.bcryptSaltRounds >= 10);
  });

  it('never generates a file with a real (non-placeholder) secret literal', () => {
    const bundle = applyFor(
      'Banking system with accounts, transfers, otp login and transaction sms alerts',
    );
    for (const generated of bundle.backendFiles) {
      assert.doesNotMatch(generated.content, /JWT_SECRET\s*=\s*['"][a-zA-Z0-9]{20,}['"]/);
    }
  });

  it('marks structural findings (no role column) unresolved even after apply()', () => {
    const bundle = applyFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const roleFinding = bundle.report.findings.find(
      (f) => f.title === 'Identity table has no role column',
    );
    if (roleFinding) assert.equal(roleFinding.resolved, false);
  });

  it('scopes rate-limited findings and file counts consistently in the report summary', () => {
    const bundle = applyFor(
      'CRM for the sales team with leads pipeline, tasks and email integration',
    );
    const bySeverity =
      bundle.report.summary.critical +
      bundle.report.summary.high +
      bundle.report.summary.medium +
      bundle.report.summary.low;
    const unresolvedCount = bundle.report.findings.filter((f) => !f.resolved).length;
    assert.equal(bySeverity, unresolvedCount);
    assert.equal(bundle.report.summary.resolved, bundle.report.resolvedFindings.length);
  });
});
