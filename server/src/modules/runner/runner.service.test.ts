/**
 * Runner tests (`npm test`). CI-safe by construction: they exercise every
 * pure layer — planning against real generated projects, port detection
 * by real binding, the log ring buffer, failure diagnosis, and workspace
 * path safety — without ever spawning npm. The spawn path itself is thin
 * glue over these layers and is exercised by live runs.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { AppError } from '../../shared/utils/app-error.js';
import {
  createSession,
  planSession,
  runAdmission,
  INTERNAL_RUNNER_OWNER,
} from './runner.service.js';
import { missingNativeBinaries } from './lib/process-supervisor.js';
import { childEnv } from './lib/child-env.js';
import { ensureEnvFile, isInside, writeWorkspace } from './lib/workspace-writer.js';
import { planProvisioning, runDatabaseName } from './lib/database-provisioner.js';
import { diagnose } from './lib/diagnostics.js';
import { LogBuffer } from './lib/log-buffer.js';
import { findFreePort, isPortAnswering } from './lib/port-scanner.js';
import type { CreateSessionRequest } from './runner.types.js';

function buildRequest(): CreateSessionRequest {
  const analysis = analyzeRequirements(
    'Hotel room booking website with online payments and email confirmations',
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
  const frontend = generateFrontend(
    plan,
    analysis.spec,
    design.databaseDesign,
    design.openapi,
    { modules: backend.modules, routes: backend.routes },
    design.entityMetadata,
  );

  return {
    projectName: plan.meta.projectName,
    files: [
      ...backend.files.map((f) => ({ path: `backend/${f.path}`, content: f.content })),
      ...frontend.files.map((f) => ({ path: `frontend/${f.path}`, content: f.content })),
    ],
  };
}

const request = buildRequest();

describe('run planning against a real generated project', () => {
  it('discovers both targets with install/start commands and env derivation', () => {
    const plan = planSession(request);
    assert.deepEqual(
      plan.targets.map((t) => t.kind),
      ['backend', 'frontend'],
    );
    for (const target of plan.targets) {
      assert.match(target.installCommand, /npm install/);
      assert.match(target.startCommand, /npm run (dev|start)/);
      assert.ok(target.npmScript === 'dev' || target.npmScript === 'start');
    }
    // The generated backend ships an .env.example the runner derives from,
    // a prisma schema the configure stage must handle, and a health route
    // readiness verifies over HTTP.
    const backend = plan.targets.find((t) => t.kind === 'backend');
    assert.ok(backend?.envFile, 'backend should carry an env file derivation');
    assert.equal(backend.prisma, true);
    assert.equal(backend.healthPath, '/api/v1/health');
    assert.ok(plan.steps.some((s) => s.name === 'configure-backend'));
    const frontend = plan.targets.find((t) => t.kind === 'frontend');
    assert.ok(frontend, 'frontend target must exist');
    assert.equal(frontend.prisma, false);
    assert.equal(frontend.healthPath, '/');
    assert.ok(plan.steps.some((s) => s.name === 'ready'));
  });

  it('rejects a run with nothing runnable instead of spawning blindly', () => {
    assert.throws(
      () =>
        createSession(
          { projectName: 'Empty', files: [{ path: 'notes.txt', content: 'hi' }] },
          'owner-test',
        ),
      (error: unknown) => AppError.isAppError(error) && error.code === 'BAD_REQUEST',
    );
  });

  it('skips targets whose package.json has no runnable script, with a warning', () => {
    const plan = planSession({
      projectName: 'NoScripts',
      files: [{ path: 'backend/package.json', content: '{"scripts":{"lint":"eslint ."}}' }],
    });
    assert.equal(plan.targets.length, 0);
    assert.ok(plan.warnings.some((w) => w.includes('no dev or start script')));
  });
});

describe('how many runs one person may start', () => {
  const alice = 'user-alice';
  const bob = 'user-bob';

  it("counts only the asker's own runs against their limit", () => {
    // Bob is at his own limit; that must say nothing about Alice.
    const active = [{ ownerId: bob }, { ownerId: bob }];
    assert.deepEqual(runAdmission(active, alice, 2, 100), { allowed: true });
    assert.ok(!runAdmission(active, bob, 2, 100).allowed);
  });

  it("never lets the platform's own validation runs block a user's preview", () => {
    // The regression: the validation mesh holds sessions under an internal
    // owner, and a shared budget let those refuse a user a preview — while
    // telling them to stop a session their session list did not contain.
    const active = [{ ownerId: INTERNAL_RUNNER_OWNER }, { ownerId: INTERNAL_RUNNER_OWNER }];
    assert.deepEqual(runAdmission(active, alice, 2, 100), { allowed: true });
  });

  it('tells the user to stop one of theirs only when one of them is theirs', () => {
    const refusal = runAdmission([{ ownerId: alice }, { ownerId: alice }], alice, 2, 100);
    assert.ok(!refusal.allowed);
    assert.match(refusal.message, /You already have 2 runs going/);

    // The slots are usually held by other projects, so the refusal has to
    // name them: the reader is on one project's page and cannot otherwise
    // tell which tab holds the run they are being told to stop.
    const named = runAdmission(
      [
        { ownerId: alice, projectName: 'College' },
        { ownerId: alice, projectName: 'NovaStack' },
      ],
      alice,
      2,
      100,
    );
    assert.ok(!named.allowed);
    assert.match(named.message, /\(College, NovaStack\)/);

    const atCapacity = runAdmission([{ ownerId: bob }, { ownerId: bob }], alice, 2, 2);
    assert.ok(!atCapacity.allowed);
    // Different fact, different sentence — nothing here is the caller's to stop.
    assert.match(atCapacity.message, /at its run capacity/);
  });
});

describe('port detection', () => {
  it('finds a genuinely free port and detects when something answers on it', async () => {
    const port = await findFreePort(49_600);
    assert.equal(await isPortAnswering(port), false);

    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen({ port, host: '127.0.0.1' }, resolve);
    });
    try {
      assert.equal(await isPortAnswering(port), true);
      // The scanner must now skip the occupied port.
      const next = await findFreePort(port);
      assert.notEqual(next, port);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('log buffer', () => {
  it('splits chunks into lines with monotonic cursors and never re-serves read lines', () => {
    const logs = new LogBuffer();
    logs.append('backend', 'first\nsecond\n');
    const chunk = logs.read(0);
    assert.deepEqual(
      chunk.lines.map((l) => l.line),
      ['first', 'second'],
    );

    logs.append('frontend', 'third');
    const incremental = logs.read(chunk.nextCursor);
    assert.deepEqual(
      incremental.lines.map((l) => l.line),
      ['third'],
    );
    assert.equal(incremental.lines[0]?.stream, 'frontend');
  });

  it('evicts old lines but keeps sequence numbers monotonic across eviction', () => {
    const logs = new LogBuffer();
    for (let i = 0; i < 2_500; i += 1) logs.append('system', `line ${String(i)}`);
    const chunk = logs.read(0);
    assert.ok(chunk.lines.length <= 2_000);
    assert.equal(chunk.lines.at(-1)?.line, 'line 2499');
    assert.equal(chunk.nextCursor, 2_500);
  });
});

describe('environment isolation', () => {
  it("never passes NexArch's own secrets to child processes", () => {
    const env = childEnv({ PORT: '4321' });
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.JWT_SECRET, undefined);
    assert.equal(env.PORT, '4321');
    // The toolchain still works: PATH must survive the whitelist.
    assert.ok(env.PATH, 'PATH must pass through');
  });

  it('keeps the list closed, so a variable nobody named cannot leak', () => {
    // Set for real, because the thing under test reads process.env: the
    // assertion above only proves these keys are absent from *this* machine's
    // environment unless they are actually present while it runs.
    const planted: Record<string, string> = {
      AI_API_KEY: 'sk-not-a-real-key',
      DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/nexarch',
      JWT_SECRET: 'platform-signing-secret',
      NEXARCH_RUNNER_DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/runs',
      SOME_FUTURE_PLATFORM_CREDENTIAL: 'whatever-comes-next',
    };
    const previous = new Map(Object.keys(planted).map((key) => [key, process.env[key]]));
    Object.assign(process.env, planted);
    try {
      const env = childEnv({ PORT: '4321' });
      for (const key of Object.keys(planted)) {
        assert.equal(env[key], undefined, `${key} must never reach a generated app`);
      }
      // A whitelist, not a blacklist — including against its own future: no
      // secret-shaped name may be appended to the passthrough list either.
      for (const key of Object.keys(env)) {
        assert.doesNotMatch(
          key,
          /SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|DATABASE/i,
          `${key} must never reach a generated app`,
        );
      }
    } finally {
      for (const [key, value] of previous) {
        // Reflect, because the keys are computed here and a dynamic
        // `delete` is a lint error; the effect is the same.
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    }
  });
});

describe('run workspace path containment', () => {
  const SESSION_ID = 'c0ffee11-2222-3333-4444-555555555555';
  const WORKSPACE = `app-${SESSION_ID.slice(0, 8)}`;

  function isBadRequest(error: unknown): boolean {
    return AppError.isAppError(error) && error.code === 'BAD_REQUEST';
  }

  /** A throwaway NEXARCH_RUNNER_DIR, restored and removed afterwards. */
  async function withRunnerDir(run: (root: string) => Promise<void>): Promise<void> {
    const previous = process.env.NEXARCH_RUNNER_DIR;
    const root = await mkdtemp(join(tmpdir(), 'nexarch-contain-'));
    process.env.NEXARCH_RUNNER_DIR = root;
    try {
      await run(root);
    } finally {
      if (previous === undefined) delete process.env.NEXARCH_RUNNER_DIR;
      else process.env.NEXARCH_RUNNER_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  }

  it('treats a sibling whose name starts with the root as outside it', () => {
    const root = join(tmpdir(), 'nexarch-runs', 'app-1');
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(root, join(root, 'backend', 'src')), true);
    // What a raw string prefix gets wrong, and the reason the check is one
    // function: `app-1` must not authorize `app-12`.
    assert.equal(isInside(root, `${root}2`), false);
    assert.equal(isInside(root, join(tmpdir(), 'nexarch-runs')), false);
  });

  it('refuses every model-supplied path that leaves the workspace', async () => {
    await withRunnerDir(async (root) => {
      const escapes = [
        '../escaped.txt',
        'backend/../../escaped.txt',
        './../escaped.txt',
        '/etc/nexarch-escaped',
        // Absolute is refused even when it lands inside: project file paths
        // are relative, and anything else means the file set is not ours.
        join(root, WORKSPACE, 'escaped.txt'),
        'backend/esc\0aped.txt',
      ];
      for (const path of escapes) {
        await assert.rejects(
          () => writeWorkspace(SESSION_ID, 'app', [{ path, content: 'x' }]),
          isBadRequest,
          `${path} must be refused`,
        );
      }
      // Nothing escaped: the run root holds the workspace and nothing else.
      assert.deepEqual(await readdir(root), [WORKSPACE]);
    });
  });

  it('writes a legitimate nested path through unchanged', async () => {
    await withRunnerDir(async (root) => {
      const dir = await writeWorkspace(SESSION_ID, 'app', [
        { path: 'backend/src/index.ts', content: 'export const ok = true;\n' },
      ]);
      assert.equal(dir, join(root, WORKSPACE));
      assert.equal(
        await readFile(join(dir, 'backend/src/index.ts'), 'utf8'),
        'export const ok = true;\n',
      );
    });
  });

  it('refuses a path that escapes through a symlinked directory', async () => {
    await withRunnerDir(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), 'nexarch-outside-'));
      try {
        // The shape npm's own install leaves behind and a lifecycle script
        // can plant: a directory component that is a link out of the
        // workspace. The path itself contains no `..` and passes every
        // textual check.
        await mkdir(join(root, WORKSPACE, 'backend'), { recursive: true });
        await symlink(outside, join(root, WORKSPACE, 'backend', 'node_modules'), 'dir');

        await assert.rejects(
          () =>
            writeWorkspace(SESSION_ID, 'app', [
              { path: 'backend/node_modules/escaped.txt', content: 'x' },
            ]),
          isBadRequest,
        );
        assert.deepEqual(await readdir(outside), []);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('refuses to follow a symlink planted at the file name itself', async () => {
    await withRunnerDir(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), 'nexarch-outside-'));
      try {
        const victim = join(outside, 'precious.txt');
        await writeFile(victim, 'original', 'utf8');
        await mkdir(join(root, WORKSPACE, 'backend'), { recursive: true });
        await symlink(victim, join(root, WORKSPACE, 'backend', 'keep.txt'));

        await assert.rejects(
          () =>
            writeWorkspace(SESSION_ID, 'app', [{ path: 'backend/keep.txt', content: 'CLOBBERED' }]),
          isBadRequest,
        );
        // The point of O_NOFOLLOW: the developer's file is untouched rather
        // than truncated through the link.
        assert.equal(await readFile(victim, 'utf8'), 'original');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('applies the same rule to the .env the configure stage writes', async () => {
    await withRunnerDir(async (root) => {
      const dir = join(root, WORKSPACE);
      await mkdir(dir, { recursive: true });
      await assert.rejects(
        () => ensureEnvFile(dir, '../escaped.env', 'backend/.env.example', { PORT: '1' }),
        isBadRequest,
      );
      // A contained one still works, with the override appended.
      await ensureEnvFile(dir, 'backend/.env', 'backend/.env.example', { PORT: '4321' });
      assert.match(await readFile(join(dir, 'backend', '.env'), 'utf8'), /^PORT=4321$/m);
    });
  });
});

describe('database provisioning plan', () => {
  it('derives a safe per-project database name', () => {
    assert.equal(runDatabaseName('Hotel Booking!'), 'nexarch_run_hotel_booking');
    assert.equal(runDatabaseName('---'), 'nexarch_run_project');
  });

  it('plans creation against the configured server, ignoring any db path on it', () => {
    const previous = process.env.NEXARCH_RUNNER_DATABASE_URL;
    process.env.NEXARCH_RUNNER_DATABASE_URL = 'mysql://root:secret@127.0.0.1:3307/whatever';
    try {
      const plan = planProvisioning('task-flow');
      assert.ok(plan);
      assert.equal(plan.databaseUrl, 'mysql://root:secret@127.0.0.1:3307/nexarch_run_task_flow');
      assert.equal(plan.serverUrl, 'mysql://root:secret@127.0.0.1:3307');
    } finally {
      if (previous === undefined) delete process.env.NEXARCH_RUNNER_DATABASE_URL;
      else process.env.NEXARCH_RUNNER_DATABASE_URL = previous;
    }
  });

  it('returns null (degraded mode) when no runner database is configured', () => {
    const previous = process.env.NEXARCH_RUNNER_DATABASE_URL;
    delete process.env.NEXARCH_RUNNER_DATABASE_URL;
    try {
      assert.equal(planProvisioning('anything'), null);
    } finally {
      if (previous !== undefined) process.env.NEXARCH_RUNNER_DATABASE_URL = previous;
    }
  });
});

describe('failure diagnosis', () => {
  it('translates a MySQL connection refusal into an actionable explanation', () => {
    const findings = diagnose(1, ['[backend] Error: connect ECONNREFUSED 127.0.0.1:3306']);
    assert.ok(findings.some((f) => f.includes('MySQL')));
  });

  it('recognizes the unsupported-auth-plugin failure a host MySQL 9 produces', () => {
    const findings = diagnose(1, ["Unknown authentication plugin `sha256_password'."]);
    assert.ok(findings.some((f) => f.includes('auth plugin')));
  });

  it('always says something useful, even with an unrecognized failure', () => {
    const findings = diagnose(137, ['[frontend] something exotic happened']);
    assert.ok(findings.length > 0);
    assert.match(findings[0] ?? '', /137/);
  });
});

describe('npm-skipped native binaries', () => {
  it('reports the platform binary an install left out, and nothing that is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexarch-native-'));
    const token = 'darwin-arm64';
    await mkdir(join(root, 'node_modules/rollup'), { recursive: true });
    await writeFile(
      join(root, 'node_modules/rollup/package.json'),
      JSON.stringify({
        optionalDependencies: {
          [`@rollup/rollup-${token}`]: '4.9.0',
          '@rollup/rollup-linux-x64-gnu': '4.9.0',
        },
      }),
    );

    // Nothing installed yet: this platform's binary is the one that matters.
    assert.deepEqual(await missingNativeBinaries(root, token), [
      { name: `@rollup/rollup-${token}`, version: '4.9.0' },
    ]);

    // Present — npm did its job, so there is nothing to repair.
    await mkdir(join(root, `node_modules/@rollup/rollup-${token}`), { recursive: true });
    assert.deepEqual(await missingNativeBinaries(root, token), []);

    await rm(root, { recursive: true, force: true });
  });

  it('ignores an optional dependency that is not a plain registry package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexarch-native-'));
    await mkdir(join(root, 'node_modules/rollup'), { recursive: true });
    await writeFile(
      join(root, 'node_modules/rollup/package.json'),
      JSON.stringify({
        optionalDependencies: {
          // Every one of these is about to become argv for `npm install`,
          // out of a manifest a generated project controls: a tarball URL
          // or a `file:` spec installs and runs code from somewhere nobody
          // chose, and a leading dash arrives as a flag.
          '@rollup/rollup-darwin-arm64': 'https://example.invalid/pkg.tgz',
          '--omit-darwin-arm64': '4.9.0',
          'rollup-darwin-arm64-local': 'file:/tmp/nexarch-not-a-package',
        },
      }),
    );

    assert.deepEqual(await missingNativeBinaries(root, 'darwin-arm64'), []);
    await rm(root, { recursive: true, force: true });
  });

  it('says nothing about a workspace that never installed such a package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexarch-native-'));
    assert.deepEqual(await missingNativeBinaries(root, 'darwin-arm64'), []);
    await rm(root, { recursive: true, force: true });
  });
});
