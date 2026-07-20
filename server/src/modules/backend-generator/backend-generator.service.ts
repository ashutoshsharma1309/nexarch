/**
 * Backend Generation Engine: orchestrates the emitters into one
 * GeneratedProject.
 *
 *   architecture + design → ProjectModel (openapi tags → modules,
 *                            classified endpoints, Prisma-backed entities)
 *   ProjectModel → shared layer + one emission per module + app wiring +
 *                  root project files + test scaffolds
 *
 * Pure and deterministic apart from the generated-at timestamp. Consumes
 * only Phase 2–4 artifacts — never a raw prompt — and never touches the
 * platform's own source tree; everything is produced as an in-memory file
 * list.
 */
import { logger } from '../../shared/logger/index.js';
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type {
  DatabaseDesign,
  EntityMetadataSet,
  EntityValidation,
  OpenApiDocument,
} from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type {
  GeneratedFile,
  GeneratedModuleSummary,
  GeneratedProject,
  GeneratedRoute,
} from './backend-generator.types.js';
import { emitAppWiring } from './lib/emit-app.js';
import { emitModule } from './lib/emit-module.js';
import { emitProjectFiles } from './lib/emit-project-files.js';
import { emitShared } from './lib/emit-shared.js';
import { emitTests } from './lib/emit-tests.js';
import { buildFolderTree, countLines } from './lib/file-tree.js';
import { buildProjectModel, entitySingular } from './lib/project-model.js';
import type { ModuleModel, ProjectModel } from './lib/project-model.js';

function summarize(mod: ModuleModel, files: readonly GeneratedFile[]): GeneratedModuleSummary {
  const prefix = `src/modules/${mod.name}/`;
  const singular = mod.entity ? entitySingular(mod.entity.entity) : mod.className;
  return {
    name: mod.className,
    entity: mod.entity?.entity ?? null,
    crud: mod.crud,
    endpoints: mod.endpoints.length,
    controller: `${mod.className}Controller`,
    service: `${singular}Service`,
    repository: mod.entity ? `${singular}Repository` : null,
    files: files.filter((f) => f.path.startsWith(prefix)).map((f) => f.path),
  };
}

function routesOf(project: ProjectModel): GeneratedRoute[] {
  const routes: GeneratedRoute[] = [];
  for (const mod of project.modules) {
    for (const endpoint of mod.endpoints) {
      routes.push({
        method: endpoint.method.toUpperCase(),
        path: `${project.apiPrefix}${mod.basePath}${endpoint.routePath === '/' ? '' : endpoint.routePath}`,
        handler: `${mod.className}Controller.${endpoint.handlerName}`,
        auth: endpoint.auth,
        implemented: endpoint.kind !== 'custom',
      });
    }
  }
  return routes;
}

export function generateBackend(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
  database: DatabaseDesign,
  prismaSchema: string,
  openapi: OpenApiDocument,
  validationRules: EntityValidation[],
  entityMetadata: EntityMetadataSet,
): GeneratedProject {
  const startedAt = performance.now();

  const project = buildProjectModel(
    architecture,
    requirements,
    database,
    openapi,
    validationRules,
    entityMetadata,
  );

  const files: GeneratedFile[] = [
    ...emitProjectFiles(project, prismaSchema),
    ...emitShared(),
    ...emitAppWiring(project, JSON.stringify(openapi, null, 2)),
    ...emitTests(project),
  ];
  for (const mod of project.modules) {
    files.push(...emitModule(mod));
  }

  const modules = project.modules.map((mod) => summarize(mod, files));
  const routes = routesOf(project);
  const implementedEndpoints = routes.filter((r) => r.implemented).length;

  const generated: GeneratedProject = {
    meta: {
      projectName: project.projectName,
      projectType: project.projectType,
      framework: 'Express 5 + Prisma',
      language: 'TypeScript',
      generatedAt: new Date().toISOString(),
      generator: 'nexarch-backend-generator/1.0',
    },
    files,
    modules,
    routes,
    folderTree: buildFolderTree(files),
    stats: {
      files: files.length,
      modules: modules.length,
      endpoints: routes.length,
      implementedEndpoints,
      linesOfCode: countLines(files),
    },
  };

  logger.info('backend generated', {
    projectType: project.projectType,
    files: generated.stats.files,
    modules: generated.stats.modules,
    endpoints: generated.stats.endpoints,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return generated;
}
