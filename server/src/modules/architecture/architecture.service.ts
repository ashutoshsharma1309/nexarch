/**
 * ArchitectureService: orchestrates the planner engines into one
 * ArchitecturePlan and its Markdown rendering. Pure and deterministic
 * (timestamp aside): the same RequirementSpec always yields the same plan,
 * which is what makes downstream regeneration diffable.
 */
import { logger } from '../../shared/logger/index.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { ArchitecturePlan, ArchitectureResponse } from './architecture.types.js';
import { planApi } from './lib/api-planner.js';
import { planDatabase } from './lib/database-planner.js';
import { planDependencies } from './lib/dependency-planner.js';
import { planFolders } from './lib/folder-planner.js';
import { planFrontend } from './lib/frontend-planner.js';
import { exportMarkdown } from './lib/markdown-exporter.js';
import { planBackendModules, planMiddleware } from './lib/module-planner.js';
import { planScalability, scoreNonFunctionals } from './lib/scalability-planner.js';
import { planSecurity } from './lib/security-planner.js';
import { decideTechnology } from './lib/technology-engine.js';

export function planArchitecture(spec: RequirementSpec): ArchitectureResponse {
  const startedAt = performance.now();

  const plan: ArchitecturePlan = {
    meta: {
      projectName: spec.projectName,
      projectType: spec.projectType,
      generatedAt: new Date().toISOString(),
      planner: 'nexarch-architecture-planner/1.0',
    },
    decisions: decideTechnology(spec),
    folderStructure: planFolders(spec),
    apiModules: planApi(spec),
    frontend: planFrontend(spec),
    database: planDatabase(spec),
    services: planBackendModules(spec),
    middleware: planMiddleware(spec),
    security: planSecurity(spec),
    dependencyGraph: planDependencies(spec),
    futureScalability: planScalability(spec),
    nonFunctional: scoreNonFunctionals(spec),
  };

  const markdown = exportMarkdown(plan);

  logger.info('architecture plan produced', {
    projectType: spec.projectType,
    apiModules: plan.apiModules.length,
    entities: plan.database.entities.length,
    edges: plan.dependencyGraph.edges.length,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return { plan, markdown };
}
