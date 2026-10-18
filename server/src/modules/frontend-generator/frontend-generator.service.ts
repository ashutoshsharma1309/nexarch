/**
 * Frontend Generation Engine: orchestrates the emitters into one
 * GeneratedFrontend.
 *
 *   architecture + design + openapi + backend-manifest + entity-metadata
 *     → FrontendProjectModel (pages derived from OpenAPI tags, each matched
 *       to its table and to whether the backend actually implemented it)
 *   FrontendProjectModel → design system + stores + API layer + forms +
 *       layouts + pages + routing + root project files
 *
 * Pure and deterministic apart from the generated-at timestamp. Consumes
 * only Phase 2–5 artifacts — never a raw prompt — and never touches the
 * platform's own source tree; everything is produced as an in-memory file
 * list, including a self-describing `frontend-manifest.json`.
 */
import { logger } from '../../shared/logger/index.js';
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type {
  DatabaseDesign,
  EntityMetadataSet,
  OpenApiDocument,
} from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type {
  BackendManifest,
  GeneratedComponentSummary,
  GeneratedFile,
  GeneratedFrontend,
  GeneratedPageSummary,
  GeneratedRouteSummary,
  GeneratedStoreSummary,
} from './frontend-generator.types.js';
import { emitApiLayer } from './lib/emit-api.js';
import { emitEntityPages } from './lib/emit-entity-pages.js';
import { emitFixedPages } from './lib/emit-fixed-pages.js';
import { emitLanding } from './lib/emit-landing.js';
import { deriveSiteDesign } from './lib/site-content.js';
import type { SiteDesign } from './lib/site-content.js';
import { emitForms } from './lib/emit-forms.js';
import { emitLayouts } from './lib/emit-layouts.js';
import { emitProjectFiles } from './lib/emit-project-files.js';
import { emitRouting } from './lib/emit-routing.js';
import { emitStores } from './lib/emit-stores.js';
import { emitStyles } from './lib/emit-styles.js';
import { emitArt } from './lib/art-kit.js';
import { emitUiData } from './lib/emit-ui-data.js';
import { emitUiOverlays } from './lib/emit-ui-overlays.js';
import { emitUiPrimitives } from './lib/emit-ui-primitives.js';
import { buildFolderTree, countLines, file } from './lib/file-tree.js';
import { buildProjectModel, entitySingular } from './lib/project-model.js';
import type { FrontendProjectModel } from './lib/project-model.js';

function summarizePages(
  model: FrontendProjectModel,
  files: readonly GeneratedFile[],
): GeneratedPageSummary[] {
  const summaries: GeneratedPageSummary[] = model.pages.map((page) => ({
    name: page.name,
    route: page.route,
    kind: 'entity-list',
    entity: page.entity?.entity ?? null,
    implemented: page.implemented,
    files: files.filter((f) => f.path.startsWith(`src/features/${page.slug}/`)).map((f) => f.path),
  }));

  summaries.unshift({
    name: 'Landing',
    route: '/',
    kind: 'landing',
    entity: null,
    implemented: true,
    files: ['src/features/landing/LandingPage.tsx', 'src/content/site.ts'],
  });
  summaries.push({
    name: 'Dashboard',
    route: '/dashboard',
    kind: 'dashboard',
    entity: null,
    implemented: true,
    files: ['src/features/dashboard/DashboardPage.tsx'],
  });
  summaries.push({
    name: 'Settings',
    route: '/settings',
    kind: 'settings',
    entity: null,
    implemented: true,
    files: ['src/features/settings/SettingsPage.tsx'],
  });
  if (model.authEnabled) {
    summaries.push(
      {
        name: 'Login',
        route: '/login',
        kind: 'auth',
        entity: null,
        implemented: true,
        files: ['src/features/auth/LoginPage.tsx'],
      },
      {
        name: 'Register',
        route: '/register',
        kind: 'auth',
        entity: null,
        implemented: true,
        files: ['src/features/auth/RegisterPage.tsx'],
      },
      {
        name: 'Profile',
        route: '/profile',
        kind: 'profile',
        entity: null,
        implemented: true,
        files: ['src/features/profile/ProfilePage.tsx'],
      },
    );
  }
  summaries.push({
    name: 'NotFound',
    route: '*',
    kind: 'not-found',
    entity: null,
    implemented: true,
    files: ['src/app/NotFoundPage.tsx'],
  });

  return summaries;
}

function summarizeComponents(
  files: readonly GeneratedFile[],
  model: FrontendProjectModel,
): GeneratedComponentSummary[] {
  const components: GeneratedComponentSummary[] = [];
  for (const generated of files) {
    if (generated.path.startsWith('src/shared/components/ui/')) {
      const name =
        generated.path
          .split('/')
          .pop()
          ?.replace(/\.tsx?$/, '') ?? generated.path;
      components.push({ name, kind: 'ui', file: generated.path });
    } else if (generated.path.startsWith('src/shared/layouts/')) {
      const name =
        generated.path
          .split('/')
          .pop()
          ?.replace(/\.tsx?$/, '') ?? generated.path;
      components.push({ name, kind: 'layout', file: generated.path });
    }
  }
  for (const page of model.pages.filter((p) => p.implemented)) {
    components.push({
      name: `${entitySingular(page.name)}Form`,
      kind: 'feature',
      file: `src/features/${page.slug}/components/${entitySingular(page.name)}Form.tsx`,
    });
  }
  return components;
}

function summarizeRoutes(model: FrontendProjectModel): GeneratedRouteSummary[] {
  const routes: GeneratedRouteSummary[] = [
    { path: '/', page: 'Landing', protected: false, lazy: true },
    { path: '/dashboard', page: 'Dashboard', protected: model.authEnabled, lazy: true },
    ...model.pages.map((page) => ({
      path: page.route,
      page: page.name,
      protected: model.authEnabled,
      lazy: true,
    })),
    { path: '/settings', page: 'Settings', protected: model.authEnabled, lazy: true },
  ];
  if (model.authEnabled) {
    routes.push(
      { path: '/profile', page: 'Profile', protected: true, lazy: true },
      { path: '/login', page: 'Login', protected: false, lazy: true },
      { path: '/register', page: 'Register', protected: false, lazy: true },
    );
  }
  routes.push({ path: '*', page: 'NotFound', protected: model.authEnabled, lazy: false });
  return routes;
}

function summarizeStores(model: FrontendProjectModel): GeneratedStoreSummary[] {
  const stores: GeneratedStoreSummary[] = [
    { name: 'theme', file: 'src/shared/store/theme.store.ts', persisted: true },
    { name: 'toast', file: 'src/shared/store/toast.store.ts', persisted: false },
    { name: 'settings', file: 'src/shared/store/settings.store.ts', persisted: true },
    { name: 'ui', file: 'src/shared/store/ui.store.ts', persisted: false },
  ];
  if (model.authEnabled) {
    stores.unshift({ name: 'auth', file: 'src/shared/store/auth.store.ts', persisted: true });
  }
  return stores;
}

export function generateFrontend(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  database: DatabaseDesign,
  openapi: OpenApiDocument,
  backendManifest: BackendManifest,
  entityMetadata: EntityMetadataSet,
  /** The website's design — model-written by the pipeline; derived from the spec when absent. */
  siteDesign?: SiteDesign,
): GeneratedFrontend {
  const startedAt = performance.now();

  const design = siteDesign ?? deriveSiteDesign(requirements);

  const model = buildProjectModel(
    architecture,
    requirements,
    database,
    openapi,
    backendManifest,
    entityMetadata,
  );

  const files: GeneratedFile[] = [
    ...emitProjectFiles(model),
    ...emitStyles(design.theme),
    ...emitUiPrimitives(),
    ...emitUiOverlays(),
    ...emitUiData(),
    ...emitStores(design.theme),
    ...emitLayouts(model.pages, model.authEnabled),
    ...emitApiLayer(model.pages, model.authEnabled),
    ...emitForms(model.pages),
    ...emitEntityPages(model.pages),
    ...emitFixedPages(model),
    ...emitLanding(design),
    ...emitArt(),
    ...emitRouting(model, design.theme),
  ];

  const pages = summarizePages(model, files);
  const components = summarizeComponents(files, model);
  const routes = summarizeRoutes(model);
  const stores = summarizeStores(model);

  const meta = {
    projectName: model.projectName,
    projectType: model.projectType,
    framework: 'React 19 + Vite',
    language: 'TypeScript',
    generatedAt: new Date().toISOString(),
    generator: 'nexarch-frontend-generator/1.0',
  };

  // The manifest is part of the deliverable — it documents the project it
  // describes, so it's appended after everything else it summarizes exists.
  const manifestPreview = { meta, pages, components, routes, stores };
  files.push(file('frontend-manifest.json', 'json', JSON.stringify(manifestPreview, null, 2)));

  const generated: GeneratedFrontend = {
    meta,
    files,
    pages,
    components,
    routes,
    stores,
    folderTree: buildFolderTree(files),
    stats: {
      files: files.length,
      pages: pages.length,
      components: components.length,
      routes: routes.length,
      stores: stores.length,
      linesOfCode: countLines(files),
    },
  };

  logger.info('frontend generated', {
    projectType: model.projectType,
    files: generated.stats.files,
    pages: generated.stats.pages,
    components: generated.stats.components,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return generated;
}

// The landing page's copy is the one generator input a model writes; the
// pipeline asks for it and hands the validated result to `generateFrontend`.
export {
  deriveSiteDesign,
  normalizeSiteDesign,
  deriveSiteContent,
  normalizeSiteContent,
  fontOf,
} from './lib/site-content.js';
export type { SiteContent, SiteDesign, SiteSection, SiteTheme } from './lib/site-content.js';
