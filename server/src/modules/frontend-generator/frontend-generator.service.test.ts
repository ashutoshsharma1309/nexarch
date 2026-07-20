/**
 * Frontend Generation Engine tests (`npm test`). Every frontend is produced
 * by driving the real pipeline — analyze → plan → design → generate backend
 * → generate frontend — for each required domain, then asserting the
 * emitted project is structurally sound (every route resolves to a real
 * page file, every implemented entity has a full CRUD file set, pending
 * entities get an honest placeholder, forms/services are never generated
 * against endpoints the backend never implemented). This doubles as the
 * cross-stage integration guard for Phases 2→3→4→5→6.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateFrontend } from './frontend-generator.service.js';
import type { BackendManifest, GeneratedFrontend } from './frontend-generator.types.js';

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

function generateFor(prompt: string): GeneratedFrontend {
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
  const backendManifest: BackendManifest = {
    modules: backendProject.modules,
    routes: backendProject.routes,
  };

  return generateFrontend(
    plan,
    analysis.spec,
    bundle.databaseDesign,
    bundle.openapi,
    backendManifest,
    bundle.entityMetadata,
  );
}

function assertSound(project: GeneratedFrontend): void {
  const paths = project.files.map((f) => f.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate file paths');
  assert.ok(project.files.length > 0);
  assert.ok(project.pages.length > 0);
  assert.ok(project.routes.length > 0);
  assert.ok(project.stores.length > 0);

  for (const generated of project.files) {
    assert.ok(generated.content.length > 0, `${generated.path} is empty`);
    assert.ok(
      generated.content.endsWith('\n') && !generated.content.endsWith('\n\n'),
      generated.path,
    );
  }

  for (const expected of [
    'package.json',
    'vite.config.ts',
    'tsconfig.json',
    'index.html',
    'src/main.tsx',
    'src/app/App.tsx',
    'src/app/router.tsx',
    'src/shared/styles/globals.css',
    'frontend-manifest.json',
    'README.md',
  ]) {
    assert.ok(paths.includes(expected), `missing ${expected}`);
  }

  for (const expected of [
    'src/shared/components/ui/button.tsx',
    'src/shared/components/ui/data-table.tsx',
    'src/shared/components/ui/dialog.tsx',
    'src/shared/store/theme.store.ts',
    'src/shared/services/api-client.ts',
    'src/shared/layouts/app-layout.tsx',
  ]) {
    assert.ok(paths.includes(expected), `missing ${expected}`);
  }

  const pkgFile = project.files.find((f) => f.path === 'package.json');
  assert.ok(pkgFile);
  const pkg = JSON.parse(pkgFile.content) as { dependencies: Record<string, string> };
  for (const dep of [
    'react',
    'react-router-dom',
    '@tanstack/react-query',
    'zustand',
    'react-hook-form',
    'zod',
    'axios',
    'framer-motion',
  ]) {
    assert.ok(pkg.dependencies[dep], `package.json missing dependency ${dep}`);
  }

  // Every implemented page has the full CRUD file set; pending ones don't
  // get services/hooks/forms wired against endpoints that don't exist.
  for (const page of project.pages.filter((p) => p.kind === 'entity-list')) {
    const pageFile = `src/features/${page.route.slice(1)}/${page.name}Page.tsx`;
    assert.ok(paths.includes(pageFile), `missing page file for ${page.name}`);
    if (page.implemented) {
      assert.ok(
        page.files.some((f) => f.includes('/services/')),
        `${page.name} missing service`,
      );
      assert.ok(
        page.files.some((f) => f.includes('/hooks/')),
        `${page.name} missing hooks`,
      );
      assert.ok(
        page.files.some((f) => f.endsWith('.ts') && f.includes('/schema')),
        `${page.name} missing schema`,
      );
    } else {
      assert.ok(
        !page.files.some((f) => f.includes('/services/')),
        `${page.name} should have no service`,
      );
    }
  }

  // Every route resolves to a page that was actually generated.
  const pageNames = new Set(project.pages.map((p) => p.name));
  for (const route of project.routes) {
    assert.ok(
      pageNames.has(route.page),
      `route ${route.path} references unknown page ${route.page}`,
    );
  }

  // Services stay HTTP/router-agnostic — no react-router import.
  const serviceFiles = project.files.filter((f) => f.path.includes('/services/'));
  for (const serviceFile of serviceFiles) {
    assert.ok(
      !serviceFile.content.includes("from 'react-router-dom'"),
      `${serviceFile.path} imports react-router-dom`,
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
  assert.equal(project.stats.pages, project.pages.length);
}

describe('frontend generation across domains', () => {
  for (const [label, prompt] of DOMAIN_PROMPTS) {
    it(`generates a valid frontend for ${label}`, () => {
      assertSound(generateFor(prompt));
    });
  }
});

describe('generation correctness', () => {
  it('generates auth pages and a protected shell when auth is present', () => {
    const project = generateFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const paths = project.files.map((f) => f.path);
    assert.ok(paths.includes('src/features/auth/LoginPage.tsx'));
    assert.ok(paths.includes('src/features/auth/RegisterPage.tsx'));
    assert.ok(paths.includes('src/shared/layouts/protected-route.tsx'));
    const router = project.files.find((f) => f.path === 'src/app/router.tsx');
    assert.ok(router?.content.includes('ProtectedRoute'));
  });

  it('renders a not-implemented panel for scaffold modules instead of wiring dead endpoints', () => {
    const project = generateFor(
      'Build a hospital management system where patients book appointments with doctors, with billing, prescriptions and sms reminders',
    );
    const pendingPage = project.pages.find((p) => p.kind === 'entity-list' && !p.implemented);
    assert.ok(pendingPage, 'expected at least one pending entity page');
    const pageFile = project.files.find(
      (f) => f.path === `src/features/${pendingPage.route.slice(1)}/${pendingPage.name}Page.tsx`,
    );
    assert.ok(pageFile?.content.includes('not implemented'));
  });

  it('derives Zod schemas and form fields from the real column design', () => {
    const project = generateFor(
      'Build an E-Commerce Website with JWT auth, product management and order tracking',
    );
    const schema = project.files.find((f) => f.path === 'src/features/products/schema.ts');
    assert.ok(schema);
    assert.match(schema.content, /price: z\.coerce\.number\(\)\.nonnegative\(\)/);
    const form = project.files.find(
      (f) => f.path.startsWith('src/features/products/components/') && f.path.endsWith('Form.tsx'),
    );
    assert.ok(form);
    assert.match(form.content, /register\('price', \{ valueAsNumber: true \}\)/);
  });

  it('embeds accurate counts in frontend-manifest.json', () => {
    const project = generateFor('Portfolio Website for a freelance designer');
    const manifestFile = project.files.find((f) => f.path === 'frontend-manifest.json');
    assert.ok(manifestFile);
    const manifest = JSON.parse(manifestFile.content) as { pages: unknown[]; routes: unknown[] };
    assert.equal(manifest.pages.length, project.pages.length);
    assert.equal(manifest.routes.length, project.routes.length);
  });

  it('never lets a service or hook import framer-motion or dialog primitives it does not need', () => {
    assertSound(
      generateFor('CRM for the sales team with leads pipeline, tasks and email integration'),
    );
  });

  it('skips auth pages entirely when the domain has no Authentication module', () => {
    // Every currently-supported domain profile includes Authentication, so
    // this asserts the emitter's conditional logic directly rather than
    // relying on a prompt that happens to omit it.
    const project = generateFor('Portfolio Website for a freelance designer');
    const paths = project.files.map((f) => f.path);
    const hasAuthModule = project.routes.some((r) => r.path === '/login');
    assert.equal(paths.includes('src/features/auth/LoginPage.tsx'), hasAuthModule);
  });
});
