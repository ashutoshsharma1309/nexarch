/**
 * Workspace service tests (`npm test`). Project CRUD, generation history,
 * and activity logging are pure unit tests against the in-memory stores.
 * Documentation and export are exercised against a `ProjectArtifacts` bag
 * built by driving the real pipeline (analyze → plan → design → generate
 * backend/frontend → apply security → build dependency graph) for one
 * domain, the same integration-guard pattern the Dependency Graph tests use
 * for Phases 2-8 — proving the workspace module consumes real upstream
 * shapes, not just fixtures shaped to fit.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import { runExport } from './lib/export-manager.js';
import { _resetActivityLog } from './lib/activity-log.js';
import { generateDocumentation } from './lib/documentation-generator.js';
import { _resetGenerationLog, listGenerations, recordGeneration } from './lib/generation-log.js';
import { generateProjectManifest } from './lib/manifest-generator.js';
import { openApiToPostmanCollection } from './lib/postman-generator.js';
import type { ProjectArtifacts } from './workspace.types.js';

beforeEach(() => {
  _resetGenerationLog();
  _resetActivityLog();
});

function buildArtifacts(prompt: string): ProjectArtifacts {
  const analysis = analyzeRequirements(prompt);
  if (analysis.status !== 'COMPLETE') assert.fail(`expected COMPLETE analysis for: ${prompt}`);
  const { plan } = planArchitecture(analysis.spec);
  const design = designDatabase(plan, analysis.spec);
  const backendProject = generateBackend(
    plan,
    analysis.spec,
    design.databaseDesign,
    design.prismaSchema,
    design.openapi,
    design.validationRules.entities,
    design.entityMetadata,
  );
  const backendManifest = { modules: backendProject.modules, routes: backendProject.routes };
  const frontendProject = generateFrontend(
    plan,
    analysis.spec,
    design.databaseDesign,
    design.openapi,
    backendManifest,
    design.entityMetadata,
  );
  const frontendManifest = {
    pages: frontendProject.pages.map((p) => ({
      name: p.name,
      route: p.route,
      kind: p.kind,
      entity: p.entity,
      implemented: p.implemented,
    })),
  };
  const security = applySecurity({
    requirements: analysis.spec,
    architecture: plan,
    database: design.databaseDesign,
    openapi: design.openapi,
    entityMetadata: design.entityMetadata,
    backendManifest,
    frontendManifest,
  });
  const graph = buildDependencyGraphBundle({
    requirements: analysis.spec,
    architecture: plan,
    database: design.databaseDesign,
    backend: {
      files: backendProject.files,
      modules: backendProject.modules,
      routes: backendProject.routes,
    },
    frontend: {
      files: frontendProject.files,
      pages: frontendProject.pages,
      components: frontendProject.components,
      routes: frontendProject.routes,
      stores: frontendProject.stores,
    },
    security: {
      backendFiles: security.backendFiles,
      frontendFiles: security.frontendFiles,
      rbac: security.rbac,
    },
  }).bundle;

  return {
    projectName: plan.meta.projectName,
    requirements: analysis.spec,
    architecture: plan,
    databaseDesign: design.databaseDesign,
    prismaSchema: design.prismaSchema,
    sqlSchema: design.sqlSchema,
    openapi: design.openapi,
    backend: {
      files: backendProject.files.map((f) => ({ path: f.path, content: f.content })),
      modules: backendProject.modules.map((m) => m.name),
      routes: backendProject.routes,
    },
    frontend: {
      files: frontendProject.files.map((f) => ({ path: f.path, content: f.content })),
      pages: frontendProject.pages.map((p) => ({ name: p.name, route: p.route })),
      components: frontendProject.components.map((c) => c.name),
    },
    security: {
      report: security.report,
      owasp: security.owasp,
      stats: security.stats,
    },
    dependencyGraph: {
      stats: graph.stats,
      quality: { recommendations: graph.quality.recommendations },
    },
  };
}

describe('generation log', () => {
  it('records and lists generations for a project, most recent first', () => {
    const project = { id: 'proj_restaurant_pos' };
    const first = recordGeneration({
      projectId: project.id,
      prompt: 'initial build',
      status: 'COMPLETED',
    });
    const second = recordGeneration({
      projectId: project.id,
      prompt: 'add loyalty program',
      status: 'FAILED',
      error: 'timeout',
    });

    const records = listGenerations(project.id);
    assert.equal(records.length, 2);
    assert.equal(records[0]?.id, second.id, 'most recent first');
    assert.equal(records[1]?.id, first.id);
    assert.equal(records[1].status, 'COMPLETED');
    assert.equal(records[0].error, 'timeout');
  });

  it('scopes listGenerations by project', () => {
    const a = { id: 'proj_a' };
    const b = { id: 'proj_b' };
    recordGeneration({ projectId: a.id, prompt: 'a run' });
    recordGeneration({ projectId: b.id, prompt: 'b run' });
    assert.equal(listGenerations(a.id).length, 1);
    assert.equal(listGenerations().length, 2);
  });
});

describe('documentation generator', () => {
  const artifacts = buildArtifacts(
    'CRM for the sales team with leads pipeline, tasks and email integration',
  );

  it('generates all seven documentation types with non-empty markdown', () => {
    const types = [
      'readme',
      'api',
      'architecture',
      'database',
      'security',
      'deployment-guide',
      'developer-guide',
    ] as const;
    for (const type of types) {
      const doc = generateDocumentation(type, artifacts);
      assert.equal(doc.type, type);
      assert.ok(doc.filename.endsWith('.md'));
      assert.ok(doc.markdown.length > 20, `${type} markdown too short`);
      assert.match(doc.markdown, /^# /);
    }
  });

  it('degrades gracefully when artifacts are missing', () => {
    const doc = generateDocumentation('database', { projectName: 'Empty Project' });
    assert.match(doc.markdown, /not been generated/);
  });

  it('embeds real entity/table names in the database doc', () => {
    const doc = generateDocumentation('database', artifacts);
    const firstTable = artifacts.databaseDesign?.tables[0];
    assert.ok(firstTable);
    assert.ok(doc.markdown.includes(firstTable.entity));
  });
});

describe('export manager', () => {
  const artifacts = buildArtifacts(
    'Inventory management system with low stock alerts, suppliers and excel export',
  );

  it('exports readme/security-report/architecture-report as markdown files', () => {
    for (const format of ['readme', 'security-report', 'architecture-report'] as const) {
      const result = runExport({ format, artifacts });
      assert.equal(result.kind, 'file');
      assert.equal(result.mimeType, 'text/markdown');
      assert.ok(result.content.length > 0);
    }
  });

  it('passes through openapi, prisma schema, and sql schema unchanged', () => {
    const openapi = runExport({ format: 'openapi', artifacts });
    const prisma = runExport({ format: 'prisma-schema', artifacts });
    const sql = runExport({ format: 'sql-schema', artifacts });
    assert.ok(
      openapi.kind === 'file' && openapi.content === JSON.stringify(artifacts.openapi, null, 2),
    );
    assert.ok(prisma.kind === 'file' && prisma.content === artifacts.prismaSchema);
    assert.ok(sql.kind === 'file' && sql.content === artifacts.sqlSchema);
  });

  it('rejects formats whose upstream artifact is missing', () => {
    assert.throws(() => runExport({ format: 'openapi', artifacts: { projectName: 'Bare' } }));
    assert.throws(() => runExport({ format: 'zip-project', artifacts: { projectName: 'Bare' } }));
  });

  it('builds a zip-project archive from backend + frontend files with content', () => {
    const result = runExport({ format: 'zip-project', artifacts });
    assert.equal(result.kind, 'archive');
    assert.ok(result.files.length > 0);
    assert.ok(result.files.every((f) => typeof f.content === 'string'));
  });

  it('rejects zip-project when file content is missing', () => {
    assert.ok(artifacts.backend);
    const stripped: ProjectArtifacts = {
      ...artifacts,
      backend: {
        ...artifacts.backend,
        files: artifacts.backend.files.map((f) => ({ path: f.path })),
      },
    };
    assert.throws(() => runExport({ format: 'zip-project', artifacts: stripped }));
  });

  it('builds a docker-package archive with a compose file and env template', () => {
    const result = runExport({ format: 'docker-package', artifacts });
    assert.equal(result.kind, 'archive');
    assert.ok(result.files.some((f) => f.path === 'docker-compose.yml'));
    assert.ok(result.files.some((f) => f.path === '.env.example'));
  });

  it('produces a project-manifest reflecting pipeline completion', () => {
    const result = runExport({ format: 'project-manifest', artifacts });
    assert.equal(result.kind, 'file');
    const manifest = JSON.parse(result.content) as { pipeline: Record<string, boolean> };
    assert.equal(manifest.pipeline.backendGenerated, true);
    assert.equal(manifest.pipeline.databaseDesigned, true);
  });
});

describe('manifest generator', () => {
  it('reports pipeline stage completion accurately for a partial project', () => {
    const manifest = generateProjectManifest({ projectName: 'Half Built' }) as {
      pipeline: Record<string, boolean>;
    };
    assert.equal(manifest.pipeline.requirementsAnalyzed, false);
  });
});

describe('postman generator', () => {
  it('converts every OpenAPI path into a Postman request grouped by top-level segment', () => {
    const artifacts = buildArtifacts(
      'Hotel room booking website with online payments and email confirmations',
    );
    assert.ok(artifacts.openapi);
    const collection = openApiToPostmanCollection(artifacts.openapi) as {
      item: { name: string; item: unknown[] }[];
    };
    assert.ok(collection.item.length > 0);
    const totalRequests = collection.item.reduce((sum, folder) => sum + folder.item.length, 0);
    const totalOperations = Object.values(artifacts.openapi.paths).reduce(
      (sum, item) => sum + Object.keys(item).length,
      0,
    );
    assert.equal(totalRequests, totalOperations);
  });
});
