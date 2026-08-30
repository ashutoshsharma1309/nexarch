/**
 * Pipeline coverage focuses on the two things that actually broke in
 * practice: the normalizer that repairs model output before the
 * deterministic stages see it, and the run engine's stage bookkeeping.
 *
 * The AI stages are pinned to the mock provider here (the model router
 * forces that under NODE_ENV=test), so these tests are offline,
 * deterministic, and free — while still exercising the real degradation
 * path a deployment without a key would take.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeSpec, toEntityName } from './lib/spec-normalizer.js';
import { deriveProjectName } from './lib/ai-stages.js';
import { getArtifacts, getRun, listRuns, startRun } from './pipeline.service.js';

async function settle(id: string): Promise<ReturnType<typeof getRun>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = getRun(id);
    if (run.status !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('pipeline run never settled');
}

describe('entity name normalization', () => {
  it('leaves an already-plural entity alone', () => {
    // Regression: double-pluralizing "Users" to "Userses" silently cost the
    // schema every foreign key, because the planner's relationship table
    // joins on exact entity names.
    assert.equal(toEntityName('Users'), 'Users');
    assert.equal(toEntityName('Orders'), 'Orders');
    assert.equal(toEntityName('Categories'), 'Categories');
  });

  it('pluralizes singular names, including the ones that end in s-like sounds', () => {
    assert.equal(toEntityName('Product'), 'Products');
    assert.equal(toEntityName('Address'), 'Addresses');
    assert.equal(toEntityName('Class'), 'Classes');
    assert.equal(toEntityName('Category'), 'Categories');
    assert.equal(toEntityName('Person'), 'People');
  });

  it('reshapes loose spellings into PascalCase entity names', () => {
    assert.equal(toEntityName('order items'), 'OrderItems');
    assert.equal(toEntityName('order_item'), 'OrderItems');
    assert.equal(toEntityName('orderItem'), 'OrderItems');
  });

  it('rejects names too short or too long to be an entity', () => {
    assert.equal(toEntityName('a'), null);
    assert.equal(toEntityName('   '), null);
  });
});

describe('requirement spec normalization', () => {
  const options = { projectName: 'Fallback Name' };

  it('always yields a Users entity, because auth is generated against it', () => {
    const spec = normalizeSpec({ database: ['Products'] }, options);
    assert.ok(spec.database.includes('Users'));
  });

  it('always yields an administrator role', () => {
    const spec = normalizeSpec({ roles: ['Customer'] }, options);
    assert.ok(spec.roles.some((role) => /admin/i.test(role)));
  });

  it('drops junk entries instead of passing them downstream', () => {
    const spec = normalizeSpec(
      { database: ['Products', 42, '', null, 'Products'], modules: ['Cart', 7] },
      options,
    );
    assert.deepEqual(spec.database, ['Users', 'Products']);
    assert.deepEqual(spec.modules, ['Cart']);
  });

  it('survives a completely unusable response', () => {
    const spec = normalizeSpec(null, options);
    assert.equal(spec.projectName, 'Fallback Name');
    assert.deepEqual(spec.database, ['Users']);
    assert.ok(spec.modules.length > 0);
    assert.ok(spec.authentication.length > 0);
  });

  it('renames entity-backed modules to their entity name', () => {
    // Regression: the generators emit real CRUD only for a module whose name
    // *is* an entity name. Left as prose, every screen in the generated app
    // reads "not implemented yet".
    const spec = normalizeSpec(
      {
        database: ['Patients', 'Doctors', 'Appointments'],
        modules: [
          'Authentication',
          'Patient Management',
          'Doctor Management',
          'Appointment Scheduling',
          'Reporting',
        ],
      },
      options,
    );
    assert.deepEqual(spec.modules, [
      'Authentication',
      'Patients',
      'Doctors',
      'Appointments',
      'Reporting',
    ]);
  });

  it('leaves a module with no entity behind it alone', () => {
    const spec = normalizeSpec(
      { database: ['Orders'], modules: ['Dashboard', 'Order Management', 'Settings'] },
      options,
    );
    assert.deepEqual(spec.modules, ['Dashboard', 'Orders', 'Settings']);
  });

  it('slugifies the project type the downstream knowledge bases key on', () => {
    assert.equal(
      normalizeSpec({ projectType: 'E-Commerce Platform' }, options).projectType,
      'e-commerce-platform',
    );
    assert.equal(normalizeSpec({ projectType: '  ' }, options).projectType, 'custom');
  });
});

describe('project naming', () => {
  it('derives a readable name from the prompt', () => {
    assert.equal(
      deriveProjectName('Build an e-commerce platform with carts and orders'),
      'Commerce Platform Carts',
    );
  });

  it('falls back rather than producing an empty name', () => {
    assert.equal(deriveProjectName('a b c'), 'Generated App');
  });
});

describe('pipeline runs', () => {
  it('runs every stage and produces a runnable file set', async () => {
    const started = startRun({
      prompt: 'Build an e-commerce platform with authentication, products, cart and orders.',
    });
    // The run is answered immediately and the work continues detached, so
    // nothing has finished yet — the first stage has already begun.
    assert.equal(started.status, 'running');
    assert.ok(started.stages.every((stage) => stage.status !== 'completed'));

    const run = await settle(started.id);
    assert.equal(run.status, 'completed', run.error ?? '');

    // The graph stage attaches its output to a project, and a run started
    // directly against the service has none — so it skips rather than
    // fails. Every generation stage must still have completed.
    const graph = run.stages.find((stage) => stage.id === 'graph');
    assert.equal(graph?.status, 'skipped');
    assert.ok(
      run.stages
        .filter((stage) => stage.id !== 'graph')
        .every((stage) => stage.status === 'completed'),
    );
    // Every stage reports what it actually produced, not a placeholder.
    assert.ok(run.stages.every((stage) => (stage.summary ?? '').length > 0));

    const artifacts = getArtifacts(run.id);
    assert.equal(artifacts.runId, run.id);
    assert.ok(artifacts.files.length > 50);
    assert.ok(artifacts.files.some((file) => file.path.startsWith('backend/')));
    assert.ok(artifacts.files.some((file) => file.path.startsWith('frontend/')));
    // The hardened security files overlay the generator's, never duplicate them.
    assert.equal(new Set(artifacts.files.map((f) => f.path)).size, artifacts.files.length);
  });

  it('reports degradation instead of failing when no model is reachable', async () => {
    // Under NODE_ENV=test the router pins to the offline mock provider, whose
    // output is not a requirement spec — exactly the shape of a real outage.
    const run = await settle(
      startRun({ prompt: 'Build a student management system with courses and attendance.' }).id,
    );
    assert.equal(run.status, 'completed');
    const analysis = run.stages.find((stage) => stage.id === 'analysis');
    assert.ok(analysis?.degraded, 'analysis should fall back to the deterministic analyzer');
    assert.match(analysis.summary ?? '', /built-in|rule-based/i);
  });

  it('rejects a run id it has never seen', () => {
    assert.throws(() => getRun('not-a-real-run'), /no longer exists/i);
  });

  it('lists runs newest first', () => {
    const [newest, older] = listRuns();
    assert.ok(newest && older, 'the earlier tests should have left at least two runs');
    assert.ok(Date.parse(newest.createdAt) >= Date.parse(older.createdAt));
  });
});
