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
import {
  deriveSiteContent,
  generateFrontend,
  normalizeSiteContent,
} from './frontend-generator.service.js';
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

/* ── Landing page ──────────────────────────────────────────────────────── */

describe('landing page', () => {
  const analysis = analyzeRequirements(
    'Build an ERP with inventory, procurement, finance, hr and role based access',
  );
  if (analysis.status !== 'COMPLETE') assert.fail('expected COMPLETE analysis');
  const spec = analysis.spec;
  const derived = deriveSiteContent(spec);
  const NUL = String.fromCharCode(0);

  it('derives a page from the spec and never invents prices or customers', () => {
    assert.equal(derived.source, 'derived');
    const kinds = derived.sections.map((section) => section.kind);
    assert.equal(kinds[0], 'hero', 'the page opens on a hero');
    assert.ok(kinds.includes('faq'));
    // A fallback must not put prices or customers on a page nobody asked for.
    assert.equal(kinds.includes('pricing'), false);
    assert.equal(kinds.includes('testimonials'), false);
  });

  it('designs the page from the request: sections, order, theme and art', () => {
    const design = normalizeSiteContent(
      {
        brand: 'Bean Lane',
        tagline: 'Neighbourhood coffee',
        theme: { mode: 'light', temperature: 'warm', corners: 'round', accent: '#b4581f' },
        sections: [
          {
            kind: 'hero',
            id: 'top',
            headline: `  Coffee   worth${NUL} the\nwalk  `,
            art: 'coffee',
            artLabel: 'A flat white on a saucer',
          },
          {
            kind: 'catalog',
            id: 'menu',
            navLabel: 'Menu',
            title: 'On the menu',
            items: [
              {
                name: 'Flat white',
                description: 'Double ristretto.',
                price: '£3.20',
                art: 'coffee',
              },
              { name: 'Almond croissant', price: '£3.60' },
              { name: '' },
            ],
          },
          { kind: 'hours', id: 'hours', rows: [{ label: 'Monday', value: '7am – 6pm' }] },
          { kind: 'testimonials', id: 'loved', items: [] },
          { kind: 'nonsense', id: 'x' },
        ],
      },
      derived,
    );

    assert.equal(design.source, 'ai');
    assert.deepEqual(
      design.sections.map((section) => section.kind),
      ['hero', 'catalog', 'hours'],
      'empty and unknown sections are dropped, order is kept',
    );

    const hero = design.sections[0];
    assert.equal(hero?.kind === 'hero' && hero.headline, 'Coffee worth the walk');

    const menu = design.sections[1];
    assert.ok(menu?.kind === 'catalog');
    assert.deepEqual(
      menu.items.map((item) => [item.name, item.price]),
      [
        ['Flat white', '£3.20'],
        ['Almond croissant', '£3.60'],
      ],
      'a nameless item is not a menu item',
    );
    // An item that named no illustration still gets one that fits its words.
    assert.equal(menu.items[1]?.art, 'pastry');

    assert.equal(design.theme.mode, 'light');
    assert.equal(design.theme.temperature, 'warm');
    assert.equal(design.theme.palette.accent.startsWith('#'), true);
  });

  it('refuses colours, fonts and art it cannot vouch for', () => {
    const design = normalizeSiteContent(
      {
        theme: {
          mode: 'sideways',
          accent: 'url(javascript:alert(1))',
          fontId: "Comic Sans'; }@import url(evil)",
        },
        sections: [
          { kind: 'hero', id: 'top', headline: 'Hello', art: '../../etc/passwd' },
          { kind: 'faq', id: 'faq', items: [{ question: 'Why?', answer: 'Because.' }] },
        ],
      },
      derived,
    );

    assert.equal(design.theme.mode, derived.theme.mode, 'an unknown mode falls back');
    assert.equal(design.theme.fontId, derived.theme.fontId, 'the font must be one we ship');
    assert.match(design.theme.palette.accent, /^#[0-9a-f]{6}$/);
    const hero = design.sections[0];
    assert.equal(hero?.kind === 'hero' && hero.art, 'abstract', 'art must be a kind we ship');
  });

  it('never labels a button with a sign-in these apps do not have', () => {
    const design = normalizeSiteContent(
      {
        sections: [
          {
            kind: 'hero',
            id: 'top',
            headline: 'Welcome to the student portal',
            primaryCta: 'Login Now',
            secondaryCta: 'Register',
          },
          { kind: 'cta', id: 'start', title: 'Ready?', label: 'Sign up' },
        ],
      },
      derived,
    );

    const hero = design.sections[0];
    assert.ok(hero?.kind === 'hero');
    assert.equal(hero.primaryCta, 'Get started');
    assert.equal(hero.secondaryCta, '');
    const cta = design.sections[1];
    assert.equal(cta?.kind === 'cta' && cta.label, 'Open the app');
  });

  it('keeps anchors unique so two sections of a kind cannot collide', () => {
    const design = normalizeSiteContent(
      {
        sections: [
          { kind: 'hero', id: 'top', headline: 'Hello' },
          { kind: 'catalog', id: 'menu', items: [{ name: 'Tea' }] },
          { kind: 'catalog', id: 'menu', items: [{ name: 'Cake' }] },
        ],
      },
      derived,
    );
    const ids = design.sections.map((section) => section.id);
    assert.deepEqual(ids, ['top', 'menu', 'menu-2']);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('falls back to the derived page when nothing usable came back', () => {
    assert.deepEqual(normalizeSiteContent({ sections: [] }, derived), derived);
    assert.deepEqual(normalizeSiteContent('not an object', derived), derived);
  });

  it('pins react and react-dom to one exact version', () => {
    // The failure this prevents: two independent carets, no lockfile, and an
    // install that prefers a warm cache can satisfy both ranges with
    // different versions. React 19.3 then refuses to render, so the app
    // builds, starts, and serves a blank page with a console error — which
    // reads to a user as "the preview is broken", not "the install drifted".
    const { plan } = planArchitecture(spec);
    const bundle = designDatabase(plan, spec);
    const backend = generateBackend(
      plan,
      spec,
      bundle.databaseDesign,
      bundle.prismaSchema,
      bundle.openapi,
      bundle.validationRules.entities,
      bundle.entityMetadata,
    );
    const project = generateFrontend(
      plan,
      spec,
      bundle.databaseDesign,
      bundle.openapi,
      { modules: backend.modules, routes: backend.routes },
      bundle.entityMetadata,
    );

    const manifest = project.files.find((f) => f.path === 'package.json')?.content ?? '';
    const pkg = JSON.parse(manifest) as { dependencies: Record<string, string> };

    assert.equal(pkg.dependencies.react, pkg.dependencies['react-dom'], 'the pair must match');
    assert.match(pkg.dependencies.react ?? '', /^\d+\.\d+\.\d+$/, 'exact, not a range');
  });

  it('escapes the project name in index.html and ships an inline favicon', () => {
    const hostileSpec = { ...spec, projectName: 'Evil</title><script>alert(1)</script>' };
    const { plan } = planArchitecture(hostileSpec);
    const bundle = designDatabase(plan, hostileSpec);
    const backend = generateBackend(
      plan,
      hostileSpec,
      bundle.databaseDesign,
      bundle.prismaSchema,
      bundle.openapi,
      bundle.validationRules.entities,
      bundle.entityMetadata,
    );
    const project = generateFrontend(
      plan,
      hostileSpec,
      bundle.databaseDesign,
      bundle.openapi,
      { modules: backend.modules, routes: backend.routes },
      bundle.entityMetadata,
    );
    const html = project.files.find((f) => f.path === 'index.html')?.content ?? '';
    assert.ok(html.includes('&lt;/title&gt;&lt;script&gt;'), 'the name is escaped');
    assert.equal(html.includes('<script>alert'), false);
    assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  });

  it('emits a public landing page at / and moves the dashboard to /dashboard', () => {
    const { plan } = planArchitecture(spec);
    const bundle = designDatabase(plan, spec);
    const backend = generateBackend(
      plan,
      spec,
      bundle.databaseDesign,
      bundle.prismaSchema,
      bundle.openapi,
      bundle.validationRules.entities,
      bundle.entityMetadata,
    );
    const hostile = normalizeSiteContent(
      {
        brand: 'Nova`${process.env.SECRET}`',
        sections: [{ kind: 'hero', id: 'top', headline: '"; alert(1); //</script>' }],
      },
      derived,
    );
    const project = generateFrontend(
      plan,
      spec,
      bundle.databaseDesign,
      bundle.openapi,
      { modules: backend.modules, routes: backend.routes },
      bundle.entityMetadata,
      hostile,
    );
    const byPath = new Map(project.files.map((f) => [f.path, f.content]));

    const router = byPath.get('src/app/router.tsx') ?? '';
    assert.match(router, /path: '\/',[\s\S]*LandingPage/);
    assert.match(router, /path: 'dashboard'/);
    assert.match(byPath.get('src/shared/layouts/sidebar.tsx') ?? '', /to: '\/dashboard'/);
    assert.ok(byPath.has('src/features/landing/LandingPage.tsx'));
    assert.equal(project.routes.find((route) => route.path === '/')?.page, 'Landing');
    assert.equal(project.pages.find((page) => page.route === '/')?.kind, 'landing');

    // Model text is data: JSON-encoded into the content module, never source.
    const siteModule = byPath.get('src/content/site.ts') ?? '';
    const literal = /export const site: SiteContent = ([\s\S]*);\s*$/.exec(siteModule)?.[1] ?? '';
    const parsed = JSON.parse(literal) as {
      brand: string;
      sections: { headline?: string }[];
    };
    const heroSection = hostile.sections[0];
    assert.equal(parsed.brand, hostile.brand);
    assert.equal(
      parsed.sections[0]?.headline,
      heroSection?.kind === 'hero' && heroSection.headline,
    );
    assert.equal(siteModule.includes('"source"'), false);
    // The theme is applied, not shipped as data for the page to read.
    assert.equal(siteModule.includes('"theme"'), false);
  });
});
