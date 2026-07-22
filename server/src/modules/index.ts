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
// The Phase 1 `generation` scaffold is superseded by the Phase 9
// orchestrator, the same way the Phase 1 `database` scaffold is
// superseded by the designer.
import { aiOrchestratorModule } from './ai-orchestrator/index.js';
import { analysisModule } from './analysis/index.js';
import { architectureModule } from './architecture/index.js';
import { authModule } from './auth/index.js';
import { backendGeneratorModule } from './backend-generator/index.js';
// The Phase 1 `database` scaffold is superseded by the Phase 4 designer,
// which implements the schema-design capability the scaffold reserved.
import { databaseModule, openapiModule } from './database-designer/index.js';
import { dependencyGraphModule } from './dependency-graph/index.js';
import { deploymentModule } from './deployment/index.js';
import { frontendGeneratorModule } from './frontend-generator/index.js';
import { healthModule } from './health/index.js';
import { reviewModule } from './review/index.js';
// The Phase 1 `security` scaffold is superseded by the Phase 7 engine, the
// same way the Phase 1 `database` scaffold is superseded by the designer.
import { securityEngineModule } from './security-engine/index.js';
import { workspaceModule } from './workspace/index.js';

export const modules: readonly AppModule[] = [
  healthModule,
  analysisModule,
  authModule,
  architectureModule,
  databaseModule,
  openapiModule,
  backendGeneratorModule,
  frontendGeneratorModule,
  securityEngineModule,
  dependencyGraphModule,
  aiOrchestratorModule,
  workspaceModule,
  deploymentModule,
  reviewModule,
];

export function registerModules(app: Express, apiPrefix: string): void {
  for (const module of modules) {
    app.use(`${apiPrefix}${module.basePath}`, module.router);
    logger.debug('module mounted', { module: module.name, path: `${apiPrefix}${module.basePath}` });
  }
  logger.info(`registered ${modules.length} modules under ${apiPrefix}`);
}
