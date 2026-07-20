/**
 * Contracts for the Backend Generation Engine (Phase 5).
 *
 * The engine consumes the earlier stages' artifacts and emits a complete
 * Express + TypeScript + Prisma backend as an in-memory `GeneratedProject`:
 * a flat list of files plus a manifest (modules, routes, folder tree, stats)
 * the Backend Explorer renders and the Security Engine (Phase 6) consumes.
 * Nothing here is written to the platform's own source tree.
 */
import type { FolderNode } from '../../shared/types/architecture.js';

export type FileLanguage =
  | 'typescript'
  | 'json'
  | 'markdown'
  | 'prisma'
  | 'env'
  | 'ignore'
  | 'javascript'
  | 'dockerfile'
  | 'html';

export interface GeneratedFile {
  /** Project-relative path, e.g. `src/modules/products/products.service.ts`. */
  path: string;
  content: string;
  language: FileLanguage;
}

export interface GeneratedRoute {
  method: string;
  /** Full mounted path, e.g. `/api/v1/products/:id`. */
  path: string;
  /** `ProductsController.findOne`. */
  handler: string;
  auth: boolean;
  /** True when the handler is fully implemented (CRUD) vs a scaffold stub. */
  implemented: boolean;
}

export interface GeneratedModuleSummary {
  name: string;
  entity: string | null;
  /** True when backed by a Prisma model (full CRUD generated). */
  crud: boolean;
  endpoints: number;
  controller: string;
  service: string;
  repository: string | null;
  files: string[];
}

export interface GeneratedProject {
  meta: {
    projectName: string;
    projectType: string;
    framework: string;
    language: string;
    generatedAt: string;
    generator: string;
  };
  files: GeneratedFile[];
  modules: GeneratedModuleSummary[];
  routes: GeneratedRoute[];
  folderTree: FolderNode[];
  stats: {
    files: number;
    modules: number;
    endpoints: number;
    implementedEndpoints: number;
    linesOfCode: number;
  };
}
