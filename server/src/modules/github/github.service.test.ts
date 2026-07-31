/**
 * GitHub service tests (`npm test`). No network, no token: these cover
 * exactly the surface that must work in an unconfigured deployment — the
 * status report, the credential gate, and the pure push-planning/README
 * layer — driving the plan from real generated files per the repo's
 * no-fixtures convention. The Git Data API executor is exercised against
 * real GitHub only when a token exists, which is never true in CI.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { AppError } from '../../shared/utils/app-error.js';
import { getPushPlan, getStatus, push } from './github.service.js';
import { buildReadme } from './lib/readme-generator.js';
import type { PushRequest } from './github.types.js';

function buildPushRequest(): PushRequest {
  const analysis = analyzeRequirements(
    'Build a gym membership platform with class schedules, trainer profiles and payments',
  );
  if (analysis.status !== 'COMPLETE') assert.fail('expected COMPLETE analysis');
  const { plan } = planArchitecture(analysis.spec);
  const design = designDatabase(plan, analysis.spec);
  const backend = generateBackend(
    plan,
    analysis.spec,
    design.databaseDesign,
    design.prismaSchema,
    design.openapi,
    design.validationRules.entities,
    design.entityMetadata,
  );

  return {
    owner: 'example',
    repo: 'gym-platform',
    branch: 'main',
    message: 'Initial generated project',
    files: backend.files.map((f) => ({ path: `backend/${f.path}`, content: f.content })),
    generateReadme: true,
    projectMeta: { projectName: plan.meta.projectName, stack: ['Express', 'Prisma', 'MySQL'] },
  };
}

const request = buildPushRequest();

describe('github status (unconfigured deployment)', () => {
  it('reports disabled with a concrete enable path when no token is set', () => {
    // CI never carries a GITHUB_TOKEN; locally one may exist — branch on reality.
    const status = getStatus();
    if (process.env.GITHUB_TOKEN) {
      assert.equal(status.configured, true);
      assert.equal(status.enableHint, null);
    } else {
      assert.equal(status.configured, false);
      assert.equal(status.tokenSource, 'none');
      assert.match(status.enableHint ?? '', /GITHUB_TOKEN/);
    }
    assert.ok(status.capabilities.includes('push'));
  });

  it('gates execution endpoints behind credentials with a FORBIDDEN AppError', async (t) => {
    if (process.env.GITHUB_TOKEN) {
      t.skip('token configured locally — the gate is open by design');
      return;
    }
    await assert.rejects(
      () => push(request),
      (error: unknown) => {
        assert.ok(AppError.isAppError(error));
        assert.equal(error.code, 'FORBIDDEN');
        assert.match(error.message, /GITHUB_TOKEN/);
        return true;
      },
    );
  });
});

describe('push planning (works with no credentials)', () => {
  it('plans the exact Git Data API step sequence over real generated files', () => {
    const plan = getPushPlan(request);
    assert.equal(plan.fileCount, request.files.length + 1); // + generated README
    assert.equal(plan.readmeIncluded, true);
    assert.ok(plan.totalBytes > 0);
    assert.deepEqual(
      plan.steps.map((s) => s.name),
      ['resolve-branch', 'create-blobs', 'create-tree', 'create-commit', 'update-ref'],
    );
  });

  it('does not double-add a README when the files already carry one', () => {
    const withReadme: PushRequest = {
      ...request,
      files: [...request.files, { path: 'README.md', content: '# Existing' }],
    };
    const plan = getPushPlan(withReadme);
    assert.equal(plan.readmeIncluded, false);
    assert.equal(plan.fileCount, withReadme.files.length);
  });

  it('warns on duplicate paths instead of silently deduplicating', () => {
    const duplicated: PushRequest = {
      ...request,
      generateReadme: false,
      files: [
        { path: 'a.ts', content: 'first' },
        { path: 'a.ts', content: 'second' },
      ],
    };
    const plan = getPushPlan(duplicated);
    assert.ok(plan.warnings.some((w) => w.includes('a.ts')));
  });
});

describe('readme generation', () => {
  it('writes compose instructions when the file set is compose-shaped, npm otherwise', () => {
    const compose = buildReadme({ projectName: 'Shop' }, ['docker-compose.yml', 'backend/x.ts']);
    assert.match(compose, /docker compose up --build/);

    const bare = buildReadme({ projectName: 'Shop' }, ['backend/x.ts', 'frontend/y.tsx']);
    assert.match(bare, /cd backend && npm install/);
    assert.match(bare, /cd frontend && npm install/);
  });

  it('lists the supplied stack and credits the generator', () => {
    const readme = buildReadme({ projectName: 'Shop', stack: ['Express', 'React'] }, []);
    assert.match(readme, /- Express/);
    assert.match(readme, /- React/);
    assert.match(readme, /NexArch/);
  });
});
