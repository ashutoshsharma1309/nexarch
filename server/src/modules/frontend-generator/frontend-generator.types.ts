/**
 * Contracts for the Frontend Generation Engine (Phase 6).
 *
 * The `GeneratedFrontend` is the in-memory React project every downstream
 * stage reads: a flat file list plus a manifest (pages, components, routes,
 * stores, stats) the Frontend Explorer renders and the Security Engine
 * (Phase 7) consumes. Nothing here is written to the platform's own source
 * tree.
 */
import type { FolderNode } from '../../shared/types/architecture.js';

export type FileLanguage =
  | 'typescript'
  | 'typescriptreact'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'env'
  | 'ignore'
  | 'javascript';

export interface GeneratedFile {
  path: string;
  content: string;
  language: FileLanguage;
}

/**
 * A single module's summary from Phase 5's backend-manifest.json. Defined
 * locally (structurally, not imported) because modules never reach into a
 * sibling module's internals — the wire contract is what's shared, not the
 * TypeScript type identity. Consumers pass Phase 5's real `GeneratedProject`
 * output; it satisfies this shape.
 */
export interface BackendModuleManifest {
  name: string;
  entity: string | null;
  crud: boolean;
  endpoints: number;
}

export interface BackendRouteManifest {
  method: string;
  path: string;
  implemented: boolean;
}

export interface BackendManifest {
  modules: BackendModuleManifest[];
  routes: BackendRouteManifest[];
}

export type FieldInputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'date'
  | 'datetime-local'
  | 'email'
  | 'password';

export interface GeneratedPageSummary {
  name: string;
  route: string;
  kind: 'entity-list' | 'dashboard' | 'auth' | 'settings' | 'profile' | 'not-found';
  entity: string | null;
  implemented: boolean;
  files: string[];
}

export interface GeneratedComponentSummary {
  name: string;
  kind: 'ui' | 'layout' | 'feature';
  file: string;
}

export interface GeneratedRouteSummary {
  path: string;
  page: string;
  protected: boolean;
  lazy: boolean;
}

export interface GeneratedStoreSummary {
  name: string;
  file: string;
  persisted: boolean;
}

export interface GeneratedFrontend {
  meta: {
    projectName: string;
    projectType: string;
    framework: string;
    language: string;
    generatedAt: string;
    generator: string;
  };
  files: GeneratedFile[];
  pages: GeneratedPageSummary[];
  components: GeneratedComponentSummary[];
  routes: GeneratedRouteSummary[];
  stores: GeneratedStoreSummary[];
  folderTree: FolderNode[];
  stats: {
    files: number;
    pages: number;
    components: number;
    routes: number;
    stores: number;
    linesOfCode: number;
  };
}
