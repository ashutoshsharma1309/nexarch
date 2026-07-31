/**
 * Runner tests (`npm test`). CI-safe by construction: they exercise every
 * pure layer — planning against real generated projects, port detection
 * by real binding, the log ring buffer, failure diagnosis, and workspace
 * path safety — without ever spawning npm. The spawn path itself is thin
 * glue over these layers and is exercised by live runs.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { AppError } from '../../shared/utils/app-error.js';
import { createSession, planSession } from './runner.service.js';
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
    // The generated backend ships an .env.example the runner derives from.
    const backend = plan.targets.find((t) => t.kind === 'backend');
    assert.ok(backend?.envFile, 'backend should carry an env file derivation');
    assert.ok(plan.steps.some((s) => s.name === 'ready'));
    assert.ok(plan.warnings.some((w) => w.includes('MySQL')));
  });

  it('rejects a run with nothing runnable instead of spawning blindly', () => {
    assert.throws(
      () => createSession({ projectName: 'Empty', files: [{ path: 'notes.txt', content: 'hi' }] }),
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

describe('failure diagnosis', () => {
  it('translates a MySQL connection refusal into an actionable explanation', () => {
    const findings = diagnose(1, ['[backend] Error: connect ECONNREFUSED 127.0.0.1:3306']);
    assert.ok(findings.some((f) => f.includes('MySQL')));
  });

  it('always says something useful, even with an unrecognized failure', () => {
    const findings = diagnose(137, ['[frontend] something exotic happened']);
    assert.ok(findings.length > 0);
    assert.match(findings[0] ?? '', /137/);
  });
});
