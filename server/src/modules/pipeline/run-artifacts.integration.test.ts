/**
 * Run-artifact persistence integration tests (`npm run test:integration`).
 *
 * These need a real database because the thing under test *is* the database.
 * Generated code used to live only in a map inside the API process, so a
 * restart left every project showing a completed build with nothing behind
 * it — no files for the Code tab, nothing for the preview to run, no baseline
 * for an edit. An in-memory fake would pass whether or not a row was ever
 * written, which is precisely the failure these tests exist to catch.
 *
 * The test for "survives a restart" is a read performed without the writer's
 * memory: nothing is cached between the write and the read below, so a bundle
 * that comes back came back from Postgres.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { prisma } from '../../shared/database/prisma.js';
import { loadRunArtifacts, saveRunArtifacts, storedRunIds } from './lib/run-artifact-store.js';
import { deriveSiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { PipelineArtifacts } from './pipeline.types.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

const OWNER = 'artifact_owner_a';
let projectId = '';

const SPEC: RequirementSpec = {
  projectName: 'Persisted Cafe',
  projectType: 'cafe',
  roles: ['Admin', 'User'],
  modules: ['Menu', 'Orders'],
  frontend: ['Landing'],
  backend: ['REST API'],
  database: ['Orders'],
  authentication: [],
  integrations: [],
  missingRequirements: [],
};

/**
 * A bundle with the shape the pipeline writes. Only the fields these tests
 * read are filled honestly; the rest are the empty values the generators
 * would produce for a project this small.
 */
function bundle(runId: string, files: { path: string; content: string }[]): PipelineArtifacts {
  return {
    runId,
    requirements: SPEC,
    architecture: { meta: { projectName: SPEC.projectName, projectType: SPEC.projectType } },
    architectureMarkdown: '# Persisted Cafe',
    design: {},
    backend: { files: [], modules: [], routes: [] },
    frontend: { files: [], pages: [], components: [], routes: [], stores: [] },
    security: { backendFiles: [], frontendFiles: [] },
    dependencies: {},
    siteDesign: deriveSiteDesign(SPEC),
    files,
  } as unknown as PipelineArtifacts;
}

before(async () => {
  const role = await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: { name: 'USER', description: 'Standard platform access' },
  });
  await prisma.user.upsert({
    where: { id: OWNER },
    update: {},
    create: {
      id: OWNER,
      email: 'artifacts-a@integration.test',
      name: 'Artifacts A',
      roleId: role.id,
    },
  });
  await prisma.project.deleteMany({ where: { ownerId: OWNER } });
  const project = await prisma.project.create({
    data: { ownerId: OWNER, name: 'Artifact Test', slug: 'artifact-test', status: 'ACTIVE' },
  });
  projectId = project.id;
});

after(async () => {
  await prisma.project.deleteMany({ where: { ownerId: OWNER } });
  await prisma.user.deleteMany({ where: { id: OWNER } });
  await prisma.$disconnect();
});

describe('run artifacts survive the process that made them', () => {
  it('stores a bundle and reads back every file byte for byte', async () => {
    const files = [
      { path: 'frontend/src/content/site.ts', content: 'export const site = { brand: "Bean" };\n' },
      { path: 'backend/src/index.ts', content: 'listen(4000);\n' },
      // Content that would break a naive serializer: quotes, newlines, unicode.
      { path: 'README.md', content: '# Bean\n\n"Persisted" — ☕\n\tTabbed\n' },
    ];
    assert.equal(
      await saveRunArtifacts('run-persist-1', projectId, bundle('run-persist-1', files)),
      true,
    );

    const loaded = await loadRunArtifacts('run-persist-1');
    assert.ok(loaded, 'a stored bundle must come back');
    assert.deepEqual(loaded.files, files, 'every file, unchanged');
    assert.equal(loaded.requirements.projectName, 'Persisted Cafe');
    assert.equal(loaded.siteDesign.sections[0]?.kind, 'hero', 'the design survives for an edit');
  });

  it('records what it stored, so a listing need not load the payload', async () => {
    const files = [{ path: 'a.ts', content: 'export const a = 1;\n' }];
    await saveRunArtifacts('run-persist-2', projectId, bundle('run-persist-2', files));

    const row = await prisma.runArtifact.findUnique({ where: { runId: 'run-persist-2' } });
    assert.ok(row);
    assert.equal(row.fileCount, 1);
    assert.ok(row.bytes > 0);
    assert.equal(row.projectId, projectId);
  });

  it('replaces a run’s bundle rather than failing or duplicating it', async () => {
    await saveRunArtifacts(
      'run-persist-3',
      projectId,
      bundle('run-persist-3', [{ path: 'a.ts', content: 'first\n' }]),
    );
    await saveRunArtifacts(
      'run-persist-3',
      projectId,
      bundle('run-persist-3', [{ path: 'a.ts', content: 'second\n' }]),
    );

    const loaded = await loadRunArtifacts('run-persist-3');
    assert.equal(loaded?.files[0]?.content, 'second\n');
    assert.equal(
      await prisma.runArtifact.count({ where: { runId: 'run-persist-3' } }),
      1,
      'one bundle per run',
    );
  });

  it('answers null for a run that stored nothing, rather than inventing a bundle', async () => {
    assert.equal(await loadRunArtifacts('run-that-never-ran'), null);
  });

  it('reports which runs have output without loading any of it', async () => {
    const stored = await storedRunIds(['run-persist-1', 'run-that-never-ran']);
    assert.equal(stored.has('run-persist-1'), true);
    assert.equal(stored.has('run-that-never-ran'), false);
  });

  it('keeps a project’s recent bundles and drops the rest', async () => {
    // Twelve builds of one project, where the store keeps ten.
    for (let index = 0; index < 12; index += 1) {
      await saveRunArtifacts(
        `run-prune-${String(index)}`,
        projectId,
        bundle(`run-prune-${String(index)}`, [
          { path: 'a.ts', content: `build ${String(index)}\n` },
        ]),
      );
    }

    const remaining = await prisma.runArtifact.count({ where: { projectId } });
    assert.ok(remaining <= 10, `kept ${String(remaining)} bundles; the cap is 10`);
    assert.ok(await loadRunArtifacts('run-prune-11'), 'the newest build is always kept');
  });

  it('goes with the project when the project goes', async () => {
    const doomed = await prisma.project.create({
      data: { ownerId: OWNER, name: 'Doomed', slug: 'doomed-artifacts', status: 'ACTIVE' },
    });
    await saveRunArtifacts(
      'run-doomed',
      doomed.id,
      bundle('run-doomed', [{ path: 'a.ts', content: 'x\n' }]),
    );
    await prisma.project.delete({ where: { id: doomed.id } });

    assert.equal(
      await loadRunArtifacts('run-doomed'),
      null,
      'a deleted project leaves no generated code behind',
    );
  });
});
