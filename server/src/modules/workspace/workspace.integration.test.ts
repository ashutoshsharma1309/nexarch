/**
 * Workspace integration tests (`npm run test:integration`).
 *
 * Separate from `workspace.service.test.ts` because these need a real
 * database. Project CRUD moved from a `Map` to Prisma when auth arrived and
 * projects got owners, and the behaviour worth testing moved with it:
 * per-owner slug disambiguation and, above all, isolation — one user's
 * queries must never see another user's rows.
 *
 * Kept out of `npm test` on purpose. The unit suite runs anywhere in
 * seconds with no services; making all of it require MySQL to cover eight
 * cases would be a bad trade.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { prisma } from '../../shared/database/prisma.js';
import { _resetActivityLog, listActivity } from './lib/activity-log.js';
import {
  createProject,
  deleteProject,
  duplicateProject,
  findOrCreateBySlug,
  getProject,
  listProjects,
  projectStatistics,
  updateProject,
} from './lib/project-store.js';
import {
  createProject as createProjectSvc,
  deleteProject as deleteProjectSvc,
  listProjectRuns,
  updateProject as updateProjectSvc,
} from './workspace.service.js';

/** Two owners, so every isolation assertion has something to be isolated from. */
const OWNER_A = 'test_owner_a';
const OWNER_B = 'test_owner_b';
let roleId: string;

async function seedUser(id: string, email: string): Promise<void> {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, email, name: `Test ${id}`, roleId },
  });
}

before(async () => {
  const role = await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: { name: 'USER', description: 'Standard platform access' },
  });
  roleId = role.id;
  await seedUser(OWNER_A, 'owner-a@integration.test');
  await seedUser(OWNER_B, 'owner-b@integration.test');
  // Cascades to generations.
  await prisma.project.deleteMany({ where: { ownerId: { in: [OWNER_A, OWNER_B] } } });
  _resetActivityLog();
});

after(async () => {
  await prisma.project.deleteMany({ where: { ownerId: { in: [OWNER_A, OWNER_B] } } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_A, OWNER_B] } } });
  await prisma.$disconnect();
});

describe('project store (persisted)', () => {
  it('creates a project with a DRAFT status, a generated slug, and no favorite', async () => {
    const project = await createProject(OWNER_A, { name: 'Acme CRM' });
    assert.equal(project.ownerId, OWNER_A);
    assert.equal(project.status, 'DRAFT');
    assert.equal(project.favorite, false);
    assert.equal(project.slug, 'acme-crm');
  });

  it('disambiguates slugs within one owner', async () => {
    const b = await createProject(OWNER_A, { name: 'Acme CRM' });
    assert.equal(b.slug, 'acme-crm-2');
  });

  it('lets a different owner reuse a slug the first owner already took', async () => {
    // The old schema had a globally unique slug, which made this fail.
    const mine = await createProject(OWNER_B, { name: 'Acme CRM' });
    assert.equal(mine.slug, 'acme-crm');
  });

  it('scopes listing, reading and statistics to the owner', async () => {
    assert.equal((await listProjects(OWNER_B, {})).length, 1);
    assert.equal((await listProjects(OWNER_A, {})).length, 2);
    assert.equal((await listProjects(OWNER_A, { search: 'acme' })).length, 2);

    const [theirs] = await listProjects(OWNER_B, {});
    assert.ok(theirs);
    assert.equal(
      await getProject(OWNER_A, theirs.id),
      undefined,
      "another owner's project is invisible",
    );

    const stats = await projectStatistics(OWNER_A);
    assert.equal(stats.totalProjects, 2);
  });

  it('updates name/description/status/favorite independently', async () => {
    const project = await createProject(OWNER_A, { name: 'Old Name', description: 'first' });
    const renamed = await updateProject(OWNER_A, project.id, { name: 'New Name' });
    assert.ok(renamed);
    assert.equal(renamed.name, 'New Name');
    assert.equal(renamed.slug, 'new-name');

    const favorited = await updateProject(OWNER_A, project.id, { favorite: true });
    assert.ok(favorited);
    assert.equal(favorited.favorite, true);
    assert.equal(favorited.name, 'New Name', 'favoriting must not clobber the rename');

    const archived = await updateProject(OWNER_A, project.id, { status: 'ARCHIVED' });
    assert.ok(archived);
    assert.equal(archived.status, 'ARCHIVED');
  });

  it('duplicates a project as a fresh DRAFT with a distinct id and slug', async () => {
    const original = await createProject(OWNER_A, { name: 'Inventory App' });
    await updateProject(OWNER_A, original.id, { status: 'ACTIVE', favorite: true });
    const copy = await duplicateProject(OWNER_A, original.id);
    assert.ok(copy);
    assert.notEqual(copy.id, original.id);
    assert.notEqual(copy.slug, original.slug);
    assert.equal(copy.status, 'DRAFT');
    assert.equal(copy.favorite, false);
  });

  it('refuses to delete across owners', async () => {
    const theirs = await createProject(OWNER_B, { name: 'Not Yours' });
    assert.equal(await deleteProject(OWNER_A, theirs.id), false, 'wrong owner must not delete');
    assert.ok(await getProject(OWNER_B, theirs.id), 'row survives');
    assert.equal(await deleteProject(OWNER_B, theirs.id), true);
  });

  it('findOrCreateBySlug returns the same project for a repeated name', async () => {
    const first = await findOrCreateBySlug(OWNER_A, 'Repeat Target');
    const second = await findOrCreateBySlug(OWNER_A, 'Repeat Target');
    assert.equal(first.id, second.id, 'a re-run must not create a second project');
  });
});

describe('project → run', () => {
  it('lists a project’s runs, newest first, and only that project’s', async () => {
    const project = await findOrCreateBySlug(OWNER_A, 'Run Owner');
    const other = await findOrCreateBySlug(OWNER_A, 'Other Project');

    await prisma.generation.create({
      data: { id: 'run_older', projectId: project.id, prompt: 'first', status: 'COMPLETED' },
    });
    await prisma.generation.create({
      data: { id: 'run_newer', projectId: project.id, prompt: 'second', status: 'FAILED' },
    });
    await prisma.generation.create({
      data: { id: 'run_elsewhere', projectId: other.id, prompt: 'unrelated', status: 'COMPLETED' },
    });

    const runs = await listProjectRuns(OWNER_A, project.id);
    assert.equal(runs.length, 2);
    const [newest, older] = runs;
    assert.ok(newest && older);
    assert.equal(newest.id, 'run_newer', 'newest first');
    assert.equal(newest.projectId, project.id);
    assert.equal(older.status, 'COMPLETED');

    await assert.rejects(
      () => listProjectRuns(OWNER_B, project.id),
      /not found/i,
      "another owner's runs are not readable",
    );
  });
});

describe('activity log', () => {
  it('logs an entry on every project lifecycle action, most recent first', async () => {
    _resetActivityLog();
    const project = await createProjectSvc(OWNER_A, { name: 'Banking App' });
    await updateProjectSvc(OWNER_A, project.id, { name: 'Banking Platform' });
    await updateProjectSvc(OWNER_A, project.id, { favorite: true });
    await updateProjectSvc(OWNER_A, project.id, { status: 'ARCHIVED' });
    await deleteProjectSvc(OWNER_A, project.id);

    assert.deepEqual(
      listActivity().map((entry) => entry.type),
      [
        'project.deleted',
        'project.archived',
        'project.favorited',
        'project.renamed',
        'project.created',
      ],
    );
  });
});
