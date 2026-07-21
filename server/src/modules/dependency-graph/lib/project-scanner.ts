/**
 * Consolidates the backend, frontend, and security bundles into one file
 * map and classifies every file by what kind of graph node it should
 * become. Classification is entirely path-pattern based — every pattern
 * matched here is a real convention the Backend/Frontend/Security Generator
 * emitters already follow (`src/modules/<mod>/controllers/*.controller.ts`,
 * `src/features/<slug>/<Name>Page.tsx`, …), not a guess.
 *
 * Security bundle files win on path collisions: Phase 7 replaces specific
 * Phase 5/6 files in place (`app.ts`, `auth.ts`, …), so its copy is the
 * authoritative final version of that path.
 */
import type {
  BackendBundle,
  FrontendBundle,
  ModuleGroup,
  NodeType,
  ProjectFile,
  SecurityBundleInput,
} from '../dependency-graph.types.js';

export interface ScannedFile extends ProjectFile {
  group: ModuleGroup;
  kind: NodeType | null;
  /** Human label for the node this file becomes, e.g. `ProductsController`. */
  label: string;
  /** The feature/module slug this file belongs to, e.g. `products`, `authentication`. */
  moduleSlug: string | null;
}

export interface ScannedProject {
  files: ScannedFile[];
  byPath: Map<string, ScannedFile>;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function labelFromFileName(path: string): string {
  const name = baseName(path).replace(/\.(tsx?|jsx?)$/, '');
  return name
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function classifyBackend(path: string): {
  group: ModuleGroup;
  kind: NodeType | null;
  moduleSlug: string | null;
} {
  const moduleMatch = /^src\/modules\/([^/]+)\//.exec(path);
  const moduleSlug = moduleMatch?.[1] ?? null;

  if (/\/controllers\/.*\.controller\.ts$/.test(path))
    return { group: 'backend', kind: 'controller', moduleSlug };
  if (/\/services\/.*\.service\.ts$/.test(path))
    return { group: 'backend', kind: 'service', moduleSlug };
  if (/\/repositories\/.*\.repository\.ts$/.test(path))
    return { group: 'backend', kind: 'repository', moduleSlug };
  if (/\/routes\/.*\.routes\.ts$/.test(path))
    return { group: 'backend', kind: 'route', moduleSlug };
  if (path.startsWith('src/shared/security/'))
    return { group: 'security', kind: 'security-module', moduleSlug };
  if (path.startsWith('src/shared/middleware/'))
    return { group: 'backend', kind: 'middleware', moduleSlug };
  if (path.startsWith('src/shared/config/'))
    return { group: 'backend', kind: 'config', moduleSlug };
  if (path.startsWith('src/shared/')) return { group: 'backend', kind: 'utility', moduleSlug };
  if (path === 'src/app.ts' || path === 'src/index.ts' || path === 'src/routes.ts') {
    return { group: 'backend', kind: 'config', moduleSlug: null };
  }
  if (path.startsWith('prisma/')) return { group: 'database', kind: null, moduleSlug: null };
  // Anything else still needs a node — app.ts's import of docs/openapi.ts,
  // dto/validators files, etc. — or edges pointing at it would reference a
  // node that doesn't exist.
  return { group: 'backend', kind: 'utility', moduleSlug };
}

function classifyFrontend(path: string): {
  group: ModuleGroup;
  kind: NodeType | null;
  moduleSlug: string | null;
} {
  const featureMatch = /^src\/features\/([^/]+)\//.exec(path);
  const moduleSlug = featureMatch?.[1] ?? null;

  if (/^src\/features\/[^/]+\/[A-Za-z]+Page\.tsx$/.test(path))
    return { group: 'frontend', kind: 'page', moduleSlug };
  if (/\/hooks\/.*\.ts$/.test(path) || path.startsWith('src/shared/hooks/')) {
    return { group: 'frontend', kind: 'hook', moduleSlug };
  }
  if (path.endsWith('.store.ts')) return { group: 'frontend', kind: 'store', moduleSlug };
  if (
    /\/components\/.*\.tsx$/.test(path) ||
    path.startsWith('src/shared/components/') ||
    path.startsWith('src/shared/layouts/')
  ) {
    return { group: 'frontend', kind: 'component', moduleSlug };
  }
  if (path.startsWith('src/shared/security/'))
    return { group: 'security', kind: 'security-module', moduleSlug };
  if (path.startsWith('src/shared/services/') || /\/services\/.*\.ts$/.test(path)) {
    return { group: 'frontend', kind: 'utility', moduleSlug };
  }
  if (path.startsWith('src/app/router'))
    return { group: 'frontend', kind: 'route', moduleSlug: null };
  if (path.startsWith('src/shared/')) return { group: 'frontend', kind: 'utility', moduleSlug };
  // Anything else still needs a node — App.tsx, main.tsx, types.ts, schema.ts, etc.
  return { group: 'frontend', kind: 'utility', moduleSlug };
}

function classifySecurity(path: string): {
  group: ModuleGroup;
  kind: NodeType | null;
  moduleSlug: string | null;
} {
  if (path.startsWith('src/shared/security/'))
    return { group: 'security', kind: 'security-module', moduleSlug: null };
  // Everything else in the security bundle overlays a backend/frontend path
  // (app.ts, auth.ts, authentication module files, guards, api-client, …) —
  // classify it the same way its destination would be.
  const backend = classifyBackend(path);
  if (backend.kind) return backend;
  const frontend = classifyFrontend(path);
  return frontend;
}

function toScanned(
  file: ProjectFile,
  classify: (path: string) => {
    group: ModuleGroup;
    kind: NodeType | null;
    moduleSlug: string | null;
  },
): ScannedFile {
  const { group, kind, moduleSlug } = classify(file.path);
  return { ...file, group, kind, moduleSlug, label: labelFromFileName(file.path) };
}

export function scanProject(
  backend: BackendBundle,
  frontend: FrontendBundle,
  security: SecurityBundleInput,
): ScannedProject {
  const byPath = new Map<string, ScannedFile>();

  for (const file of backend.files) byPath.set(file.path, toScanned(file, classifyBackend));
  for (const file of frontend.files) byPath.set(file.path, toScanned(file, classifyFrontend));
  // Security overlays win on collision — it is the authoritative hardened
  // version of any path Phase 7 replaced.
  for (const file of security.backendFiles)
    byPath.set(file.path, toScanned(file, classifySecurity));
  for (const file of security.frontendFiles)
    byPath.set(file.path, toScanned(file, classifySecurity));

  return { files: [...byPath.values()], byPath };
}
