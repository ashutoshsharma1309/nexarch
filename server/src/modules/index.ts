/**
 * Module loader.
 *
 * The one registry of feature modules. Adding a feature to the API is:
 * build the module folder, export an AppModule, add it to this array —
 * nothing else in the codebase changes. Mount order is irrelevant because
 * modules own disjoint URL subtrees.
 */
import type { Express } from 'express';

import { logger } from '../shared/logger/index.js';
import type { AppModule } from '../shared/types/module.js';
import { analysisModule } from './analysis/index.js';
import { architectureModule } from './architecture/index.js';
import { authModule } from './auth/index.js';
// The Phase 1 `database` scaffold is superseded by the Phase 4 designer,
// which implements the schema-design capability the scaffold reserved.
import { databaseModule, openapiModule } from './database-designer/index.js';
import { generationModule } from './generation/index.js';
import { healthModule } from './health/index.js';
import { reviewModule } from './review/index.js';
import { securityModule } from './security/index.js';

export const modules: readonly AppModule[] = [
  healthModule,
  analysisModule,
  authModule,
  generationModule,
  architectureModule,
  databaseModule,
  openapiModule,
  securityModule,
  reviewModule,
];

export function registerModules(app: Express, apiPrefix: string): void {
  for (const module of modules) {
    app.use(`${apiPrefix}${module.basePath}`, module.router);
    logger.debug('module mounted', { module: module.name, path: `${apiPrefix}${module.basePath}` });
  }
  logger.info(`registered ${modules.length} modules under ${apiPrefix}`);
}
