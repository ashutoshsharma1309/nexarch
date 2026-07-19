/**
 * Contract every feature module must satisfy to be mounted by the module
 * loader (`src/modules/index.ts`).
 *
 * A module owns a URL subtree and everything beneath it — routes, services,
 * validation, types. Modules never import from each other's internals; they
 * share code only through `src/shared`. That boundary is what lets Phase 2+
 * drop in the generation pipeline without touching existing modules.
 */
import type { Router } from 'express';

export interface AppModule {
  /** Unique machine name, used in logs and diagnostics. */
  readonly name: string;
  /** Mount point beneath the API prefix, e.g. `/auth` → `/api/v1/auth`. */
  readonly basePath: `/${string}`;
  /** One-line purpose, surfaced by module manifests and docs. */
  readonly description: string;
  readonly router: Router;
}
