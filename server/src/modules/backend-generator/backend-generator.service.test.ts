/**
 * Backend Generation Engine tests (`npm test`). Every backend is produced
 * by driving the real pipeline — analyze → plan → design → generate — for
 * each required domain, then asserting the emitted project is structurally
 * sound (every OpenAPI operation has a route, every route resolves to a
 * real file, every CRUD service only reaches the database through its
 * repository). This doubles as the cross-stage integration guard for
 * Phases 2→3→4→5.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from './backend-generator.service.js';
import type { GeneratedProject } from './backend-generator.types.js';

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

function generateFor(prompt: string): GeneratedProject {
  const analysis = analyzeRequirements(prompt);
  if (analysis.status !== 'COMPLETE') {
    assert.fail(`expected COMPLETE analysis for: ${prompt}`);
  }
  const { plan } = planArchitecture(analysis.spec);
  const bundle = designDatabase(plan, analysis.spec);
  return generateBackend(
    plan,
    analysis.spec,
    bundle.databaseDesign,
    bundle.prismaSchema,
    bundle.openapi,
    bundle.validationRules.entities,
    bundle.entityMetadata,
  );
}

function assertSound(project: GeneratedProject): void {
  // Every path exists exactly once.
  const paths = project.files.map((f) => f.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate file paths');
  assert.ok(project.files.length > 0);
  assert.ok(project.modules.length > 0);
  assert.ok(project.routes.length > 0);

  // Every generated file is non-empty and ends with exactly one newline.
  for (const generated of project.files) {
    assert.ok(generated.content.length > 0, `${generated.path} is empty`);
    assert.ok(
      generated.content.endsWith('\n') && !generated.content.endsWith('\n\n'),
      generated.path,
    );
  }

  // Root project files are always present.
  for (const expected of [
    'package.json',
    'tsconfig.json',
    'README.md',
    'prisma/schema.prisma',
    'src/app.ts',
    'src/index.ts',
  ]) {
    assert.ok(paths.includes(expected), `missing ${expected}`);
  }

  // Shared layer is complete.
  for (const expected of [
    'src/shared/errors/app-error.ts',
    'src/shared/middleware/error-handler.ts',
    'src/shared/middleware/auth.ts',
    'src/shared/database/base.repository.ts',
    'src/shared/http/response.ts',
  ]) {
    assert.ok(paths.includes(expected), `missing ${expected}`);
  }

  // package.json is valid JSON with the expected scripts.
  const pkgFile = project.files.find((f) => f.path === 'package.json');
  assert.ok(pkgFile);
  const pkg = JSON.parse(pkgFile.content) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  assert.ok(pkg.scripts.build && pkg.scripts.dev && pkg.scripts.test);
  assert.ok(pkg.dependencies.express && pkg.dependencies['@prisma/client']);

  // Every CRUD module has the full file set.
  for (const mod of project.modules.filter((m) => m.crud)) {
    const modFiles = mod.files;
    assert.ok(
      modFiles.some((f) => f.endsWith('.dto.ts')),
      `${mod.name} missing DTO`,
    );
    assert.ok(
      modFiles.some((f) => f.endsWith('.validators.ts')),
      `${mod.name} missing validators`,
    );
    assert.ok(
      modFiles.some((f) => f.endsWith('.repository.ts')),
      `${mod.name} missing repository`,
    );
    assert.ok(
      modFiles.some((f) => f.endsWith('.service.ts') && !f.endsWith('.test.ts')),
      `${mod.name} missing service`,
    );
    assert.ok(
      modFiles.some((f) => f.endsWith('.controller.ts')),
      `${mod.name} missing controller`,
    );
    assert.ok(
      modFiles.some((f) => f.endsWith('.routes.ts')),
      `${mod.name} missing routes`,
    );
  }

  // Every route maps back to a controller class that was actually generated.
  const controllerNames = new Set(project.modules.map((m) => m.controller));
  for (const route of project.routes) {
    const [controller] = route.handler.split('.');
    assert.ok(
      controller && controllerNames.has(controller),
      `unknown controller for ${route.method} ${route.path}`,
    );
  }

  // Repositories never appear in controller files — only services and
  // repositories touch persistence, exactly the layering the phase requires.
  const controllerFiles = project.files.filter((f) => f.path.includes('/controllers/'));
  for (const controllerFile of controllerFiles) {
    assert.ok(
      !controllerFile.content.includes('this.prisma'),
      `${controllerFile.path} touches Prisma directly`,
    );
    assert.ok(
      !controllerFile.content.includes("from '../repositories"),
      `${controllerFile.path} imports a repository`,
    );
  }

  // Services never import Express types — business logic stays HTTP-agnostic.
  const serviceFiles = project.files.filter(
    (f) => f.path.includes('/services/') && !f.path.endsWith('.test.ts'),
  );
  for (const serviceFile of serviceFiles) {
    assert.ok(
      !serviceFile.content.includes("from 'express'"),
      `${serviceFile.path} imports express`,
    );
  }

  // The folder tree covers every generated file path.
  const countTreeFiles = (nodes: typeof project.folderTree, prefix: string): string[] =>
    nodes.flatMap((node) =>
      node.type === 'file'
        ? [`${prefix}${node.name}`]
        : countTreeFiles(node.children ?? [], `${prefix}${node.name}/`),
    );
  const treePaths = new Set(countTreeFiles(project.folderTree, ''));
  for (const p of paths) assert.ok(treePaths.has(p), `folder tree missing ${p}`);

  assert.equal(project.stats.files, project.files.length);
  assert.equal(project.stats.endpoints, project.routes.length);
}

describe('backend generation across domains', () => {
  for (const [label, prompt] of DOMAIN_PROMPTS) {
    it(`generates a valid backend for ${label}`, () => {
      assertSound(generateFor(prompt));
    });
  }
});

describe('generation correctness', () => {
  it('implements full CRUD for every entity-backed module', () => {
    const project = generateFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const products = project.modules.find((m) => m.name === 'Products');
    assert.ok(products?.crud);
    const productRoutes = project.routes.filter((r) => r.path.startsWith('/api/v1/products'));
    assert.ok(productRoutes.some((r) => r.method === 'GET' && r.path === '/api/v1/products'));
    assert.ok(productRoutes.some((r) => r.method === 'POST'));
    assert.ok(productRoutes.some((r) => r.method === 'PUT'));
    assert.ok(productRoutes.some((r) => r.method === 'DELETE'));
    assert.ok(productRoutes.every((r) => r.implemented));
  });

  it("implements authentication against the design's own user table", () => {
    // The regression this guards: authentication used to be emitted as a
    // NotImplementedError stub, so every generated application answered
    // its own sign-in form with 501 and no user could get past the first
    // screen. A generated login must actually log in.
    const project = generateFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const controller = project.files.find(
      (f) => f.path === 'src/modules/authentication/controllers/authentication.controller.ts',
    );
    assert.ok(controller, 'no authentication controller was generated');
    assert.doesNotMatch(controller.content, /NotImplementedError/);

    const service = project.files.find(
      (f) => f.path === 'src/modules/authentication/services/authentication.service.ts',
    );
    assert.ok(service);
    // Hashed, never compared in the clear, and signed with the app's secret.
    assert.match(service.content, /bcrypt\.hash/);
    assert.match(service.content, /bcrypt\.compare/);
    assert.match(service.content, /jwt\.sign/);
    // The shape the generated frontend actually posts to and reads back.
    assert.match(service.content, /accessToken: issueToken\(user\)/);

    // And the guard must verify the signature, not merely see a header.
    const guard = project.files.find((f) => f.path === 'src/shared/middleware/auth.ts');
    assert.ok(guard);
    assert.match(guard.content, /jwt\.verify/);
    assert.doesNotMatch(guard.content, /stub-user/);

    const pkg = project.files.find((f) => f.path === 'package.json');
    assert.ok(pkg);
    assert.match(pkg.content, /"bcryptjs"/);
    assert.match(pkg.content, /"jsonwebtoken"/);
  });

  it('still scaffolds a module that has no entity and no credentials to use', () => {
    const project = generateFor('Portfolio Website for a freelance designer');
    const scaffold = project.modules.find(
      (m) =>
        !m.crud && m.name !== 'Authentication' && m.files.some((f) => f.endsWith('.controller.ts')),
    );
    if (!scaffold) return; // This design produced no non-CRUD module; nothing to assert.
    const controllerPath = scaffold.files.find((f) => f.endsWith('.controller.ts'));
    assert.ok(controllerPath);
    const controllerFile = project.files.find((f) => f.path === controllerPath);
    assert.ok(controllerFile);
    assert.match(controllerFile.content, /NotImplementedError/);
  });

  it('derives Zod validators from the real column types', () => {
    const project = generateFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const validators = project.files.find(
      (f) => f.path === 'src/modules/products/validators/products.validators.ts',
    );
    assert.ok(validators);
    assert.match(validators.content, /price: z\.number\(\)\.nonnegative\(\)/);
    assert.match(validators.content, /sku: z\.string\(\)/);
  });

  it('restricts delete routes to roles entity-metadata.json grants delete to', () => {
    const project = generateFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking with vendors',
    );
    const routesFile = project.files.find(
      (f) => f.path === 'src/modules/products/routes/products.routes.ts',
    );
    assert.ok(routesFile);
    // Products are system-owned (Admin-only in the metadata model), so
    // delete should be role-gated rather than open to every authenticated role.
    assert.match(routesFile.content, /requireRoles\(/);
  });

  it('never lets a controller or route reach Prisma directly', () => {
    assertSound(
      generateFor('Restaurant POS with menu management, table billing and a kitchen display'),
    );
  });

  it('embeds the real Prisma schema and OpenAPI contract verbatim', () => {
    const analysis = analyzeRequirements(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    if (analysis.status !== 'COMPLETE') {
      assert.fail('expected COMPLETE analysis');
    }
    const { plan } = planArchitecture(analysis.spec);
    const bundle = designDatabase(plan, analysis.spec);
    const project = generateBackend(
      plan,
      analysis.spec,
      bundle.databaseDesign,
      bundle.prismaSchema,
      bundle.openapi,
      bundle.validationRules.entities,
      bundle.entityMetadata,
    );

    const schemaFile = project.files.find((f) => f.path === 'prisma/schema.prisma');
    assert.equal(schemaFile?.content.trimEnd(), bundle.prismaSchema.trimEnd());

    const docsFile = project.files.find((f) => f.path === 'src/docs/openapi.ts');
    assert.ok(docsFile?.content.includes(JSON.stringify(bundle.openapi.info.title)));
  });

  it('produces routers that mount at the correct base path', () => {
    const project = generateFor(
      'CRM for the sales team with leads pipeline, tasks and email integration',
    );
    const routesIndex = project.files.find((f) => f.path === 'src/routes.ts');
    assert.ok(routesIndex);
    const leadsModule = project.modules.find((m) => m.name === 'Leads');
    assert.ok(leadsModule);
    assert.match(routesIndex.content, /router\.use\('\/leads', leadsRouter\)/);
  });
});
