/**
 * Scaffold router for modules whose implementation lands in a later phase.
 *
 * Rather than empty files or ad-hoc 404s, an unimplemented module exposes a
 * machine-readable manifest at its root (useful for smoke tests and the
 * client's module registry) and answers everything else with an honest 501.
 * When a module is implemented, its scaffold router is replaced by a real one
 * and this helper simply stops being imported there.
 */
import { Router } from 'express';

import { AppError } from './app-error.js';
import { sendSuccess } from './api-response.js';

export interface ModuleManifest {
  readonly module: string;
  readonly summary: string;
  /** Roadmap phase in which the module gains its implementation. */
  readonly plannedPhase: number;
  /** Capabilities the module will expose once implemented. */
  readonly capabilities: readonly string[];
  readonly status: 'scaffold';
}

export function createScaffoldRouter(manifest: ModuleManifest): Router {
  const router: Router = Router();

  router.get('/', (_req, res) => {
    sendSuccess(res, manifest);
  });

  // Express 5 wildcard syntax: `{*splat}` matches any remaining path.
  router.all('/{*splat}', (_req, _res, next) => {
    next(
      AppError.notImplemented(
        `The "${manifest.module}" module is scheduled for phase ${manifest.plannedPhase} and is not implemented yet`,
      ),
    );
  });

  return router;
}
