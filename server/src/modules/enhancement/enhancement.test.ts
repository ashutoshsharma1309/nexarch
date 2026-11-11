/**
 * The rules that decide whether an enhancement may claim anything: what it may
 * write, what counts as done, and which outcomes leave the project untouched.
 * Network and model calls are stubbed; the lifecycle tests live beside this.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCoverage, missingAreas } from './lib/coverage.js';
import { applyEdits, carriesSecret } from './lib/file-patch.js';
import { runAuthFlow, runCrudFlow } from './lib/functional-checks.js';
import { classifyInstruction, decideResearch } from './lib/intent.js';
import { renderPrompt } from '../ai-orchestrator/lib/prompt-engine.js';
import { parsePlan, unsafePathReason } from './lib/plan-parser.js';
import type { AuthFlowSpec, CrudFlowSpec } from './enhancement.types.js';

describe('the enhancement prompts', () => {
  const fill = (names: string[]) => Object.fromEntries(names.map((name) => [name, 'x']));

  it('plan prompt takes exactly what the planner sends', () => {
    const rendered = renderPrompt(
      'enhance-plan',
      fill([
        'INSTRUCTION',
        'KIND',
        'PROJECT_SUMMARY',
        'ARCHITECTURE_CONTEXT',
        'IMPACT',
        'MANIFEST',
        'EXCERPTS',
        'REQUIRED_COVERAGE',
        'GAP_NOTE',
      ]),
    );
    assert.deepEqual(rendered.missingVariables, []);
  });

  it('implement prompt takes exactly what the implementer sends', () => {
    const rendered = renderPrompt(
      'enhance-implement',
      fill([
        'INSTRUCTION',
        'PLAN_SUMMARY',
        'FILE_PATH',
        'ACTION',
        'REASON',
        'FILE_CONTENT',
        'RELATED',
        'RETRY_NOTE',
      ]),
    );
    assert.deepEqual(rendered.missingVariables, []);
  });
});

describe('classifyInstruction', () => {
  const cases: [string, string][] = [
    ['add login and a protected dashboard', 'add-authentication'],
    ['add a database for the notes', 'add-database'],
    ['integrate the Stripe api for checkout', 'integrate-api'],
    ['fix the broken contact form', 'fix-bug'],
    ['make the site work on mobile phones', 'improve-mobile'],
    ['improve accessibility for screen reader users', 'improve-accessibility'],
    ['add tests for the booking service', 'add-tests'],
    ['refactor the orders module', 'refactor'],
    ['research more features competitors offer', 'research-features'],
  ];
  for (const [instruction, kind] of cases) {
    it(`reads "${instruction}" as ${kind}`, () => {
      assert.equal(classifyInstruction(instruction), kind);
    });
  }

  it('does not treat a button on the sign up page as adding authentication', () => {
    assert.notEqual(classifyInstruction('add a button to the sign up page'), 'add-authentication');
  });
});

describe('decideResearch', () => {
  it('does not search for a change the codebase can answer', () => {
    const decision = decideResearch({
      kind: 'fix-bug',
      instruction: 'fix the footer',
      providersConfigured: true,
    });
    assert.equal(decision.run, false);
  });

  it('searches when the request depends on the outside world', () => {
    const decision = decideResearch({
      kind: 'integrate-api',
      instruction: 'integrate the stripe api',
      providersConfigured: true,
    });
    assert.equal(decision.run, true);
  });

  it('says so when research would help but no provider is configured', () => {
    const decision = decideResearch({
      kind: 'research-features',
      instruction: 'research features',
      providersConfigured: false,
    });
    assert.equal(decision.run, false);
    assert.equal(decision.unavailable, true);
  });

  it('lets an explicit no win', () => {
    const decision = decideResearch({
      kind: 'research-features',
      instruction: 'research features',
      explicit: false,
      providersConfigured: true,
    });
    assert.equal(decision.run, false);
  });
});

describe('what a plan may write', () => {
  for (const path of [
    '../outside.ts',
    '/etc/passwd',
    'backend/.env',
    'backend/.env.production',
    'backend/node_modules/x/index.js',
    'frontend/package-lock.json',
    'src/elsewhere.ts',
  ]) {
    it(`refuses ${path}`, () => {
      assert.notEqual(unsafePathReason(path), null);
    });
  }

  for (const path of ['backend/.env.example', 'frontend/src/features/build/page.tsx']) {
    it(`allows ${path}`, () => {
      assert.equal(unsafePathReason(path), null);
    });
  }

  it('checks actions against the real file list', () => {
    const parsed = parsePlan(
      {
        files: [
          { path: 'backend/new.ts', action: 'modify', reason: 'r' },
          { path: 'backend/a.ts', action: 'create', reason: 'r' },
          { path: 'backend/ghost.ts', action: 'delete', reason: 'r' },
          { path: 'backend/.env', action: 'modify', reason: 'r' },
        ],
      },
      new Set(['backend/a.ts']),
    );
    assert.deepEqual(
      parsed.files.map((file) => [file.path, file.action]),
      [
        ['backend/new.ts', 'create'],
        ['backend/a.ts', 'modify'],
      ],
    );
    assert.equal(parsed.rejected.length, 2);
  });

  it('refuses a functional check that points off the app', () => {
    const parsed = parsePlan(
      {
        functionalChecks: [
          { kind: 'crud', collectionPath: '//evil.test/x', createBody: {}, updateBody: {} },
        ],
      },
      new Set(),
    );
    assert.deepEqual(parsed.functionalChecks, []);
  });
});

describe('applyEdits', () => {
  it('applies an exact, unique change', () => {
    assert.deepEqual(applyEdits('const a = 1;\n', [{ find: 'a = 1', replace: 'a = 2' }]), {
      ok: true,
      content: 'const a = 2;\n',
    });
  });

  it('reports a miss rather than guessing', () => {
    assert.equal(applyEdits('const a = 1;\n', [{ find: 'b = 1', replace: 'x' }]).ok, false);
  });

  it('refuses an ambiguous search', () => {
    assert.equal(applyEdits('a\nb\na\n', [{ find: 'a', replace: 'x' }]).ok, false);
  });

  it('matches text the prompt showed without its comment lines', () => {
    const file = 'function f() {\n  // explain\n  return 1;\n}\n';
    const patched = applyEdits(file, [
      { find: 'function f() {\n  return 1;', replace: 'function f() {\n  return 2;' },
    ]);
    assert.deepEqual(patched, { ok: true, content: 'function f() {\n  return 2;\n}\n' });
  });
});

describe('carriesSecret', () => {
  it('catches provider keys and private keys', () => {
    assert.equal(carriesSecret(`const k = "sk-${'a'.repeat(30)}"`), true);
    assert.equal(carriesSecret('-----BEGIN RSA PRIVATE KEY-----'), true);
  });

  it('leaves reading from configuration alone', () => {
    assert.equal(carriesSecret('const key = process.env.STRIPE_API_KEY;'), false);
  });
});

describe('coverage', () => {
  const full = [
    'backend/src/modules/auth/auth.routes.ts',
    'backend/prisma/schema.prisma',
    'backend/src/modules/auth/auth.service.ts',
    'frontend/src/features/auth/login-page.tsx',
    'frontend/src/shared/auth-store.ts',
    'backend/.env.example',
  ];

  it('accepts authentication that really touches every area', () => {
    assert.deepEqual(missingAreas(evaluateCoverage('add-authentication', full)), []);
  });

  it('names what a one-file "authentication" left out', () => {
    const gaps = missingAreas(evaluateCoverage('add-authentication', [String(full[0])]));
    assert.deepEqual(
      gaps.map((area) => area.area),
      ['schema', 'persistence', 'frontend-forms', 'session', 'env'],
    );
  });

  it('asks nothing of kinds with no fixed areas', () => {
    assert.deepEqual(evaluateCoverage('improve-visuals', []), []);
  });

  it('counts existing areas when the project already has the capability', () => {
    assert.deepEqual(missingAreas(evaluateCoverage('add-authentication', [], full)), []);
  });
});

/** A small in-memory app answering the way a real one would. */
function authApp(options: { protectedOpen?: boolean; bearer?: boolean } = {}) {
  let signedIn = false;
  const fake = (input: unknown, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const credentialed = Boolean(headers.cookie ?? headers.authorization);
    if (path === '/auth/register') return Promise.resolve(new Response('{}', { status: 201 }));
    if (path === '/auth/login') {
      signedIn = true;
      return Promise.resolve(
        options.bearer
          ? Response.json({ data: { accessToken: 'tok' } })
          : new Response('{}', { headers: { 'set-cookie': 'sid=abc; HttpOnly' } }),
      );
    }
    if (path === '/auth/logout') {
      signedIn = false;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const allowed = options.protectedOpen === true || (credentialed && signedIn);
    return Promise.resolve(new Response('{}', { status: allowed ? 200 : 401 }));
  };
  return fake as typeof fetch;
}

const AUTH: AuthFlowSpec = {
  kind: 'auth',
  register: { method: 'POST', path: '/auth/register' },
  login: { method: 'POST', path: '/auth/login' },
  logout: { method: 'POST', path: '/auth/logout' },
  protected: { method: 'GET', path: '/me' },
  emailField: 'email',
  passwordField: 'password',
  extraRegisterFields: {},
};

describe('runAuthFlow', () => {
  it('passes a cookie app that really refuses after logout', async () => {
    const result = await runAuthFlow('http://127.0.0.1:9', AUTH, { fetch: authApp() });
    assert.equal(result.passed, true);
    assert.equal(result.limitations.length, 0);
  });

  it('fails when the protected route admits a visitor', async () => {
    const result = await runAuthFlow('http://127.0.0.1:9', AUTH, {
      fetch: authApp({ protectedOpen: true }),
    });
    assert.equal(result.passed, false);
    assert.equal(result.steps[0]?.passed, false);
  });

  it('states what it could not establish about bearer logout', async () => {
    const result = await runAuthFlow('http://127.0.0.1:9', AUTH, {
      fetch: authApp({ bearer: true }),
    });
    assert.equal(result.passed, true);
    assert.equal(result.limitations.length, 1);
  });

  it('counts an unreachable app as not passed', async () => {
    const down = (() => Promise.reject(new TypeError('refused'))) as typeof fetch;
    const result = await runAuthFlow('http://127.0.0.1:9', AUTH, { fetch: down });
    assert.equal(result.passed, false);
  });

  it('never records the throwaway password', async () => {
    const result = await runAuthFlow('http://127.0.0.1:9', AUTH, { fetch: authApp() });
    assert.doesNotMatch(JSON.stringify(result), /Chk-/);
  });
});

const CRUD: CrudFlowSpec = {
  kind: 'crud',
  resource: 'note',
  collectionPath: '/notes',
  createBody: { title: 'a' },
  updateBody: { title: 'b' },
  idField: 'id',
};

function crudApp(options: { dropUpdates?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const fake = async (input: unknown, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    const { pathname } = new URL(String(input));
    const id = pathname.split('/')[2];
    const method = init?.method ?? 'GET';
    if (pathname === '/notes' && method === 'POST') {
      rows.set('1', { id: 1, ...(JSON.parse(init?.body as string) as object) });
      return Response.json({ data: rows.get('1') }, { status: 201 });
    }
    if (pathname === '/notes') return Response.json({ data: [...rows.values()] });
    const row = id === undefined ? undefined : rows.get(id);
    if (!row || id === undefined) return new Response('{}', { status: 404 });
    if (method === 'PATCH') {
      if (!options.dropUpdates)
        rows.set(id, { ...row, ...(JSON.parse(init?.body as string) as object) });
      return Response.json({ data: rows.get(id) });
    }
    if (method === 'DELETE') {
      rows.delete(id);
      return new Response(null, { status: 204 });
    }
    return Response.json({ data: row });
  };
  return fake as typeof fetch;
}

describe('runCrudFlow', () => {
  it('passes a real round trip', async () => {
    const result = await runCrudFlow('http://127.0.0.1:9', CRUD, { fetch: crudApp() });
    assert.equal(result.passed, true, JSON.stringify(result.steps));
  });

  it('fails when an update answers 200 but saves nothing', async () => {
    const result = await runCrudFlow('http://127.0.0.1:9', CRUD, {
      fetch: crudApp({ dropUpdates: true }),
    });
    assert.equal(result.passed, false);
    assert.equal(result.steps.find((step) => !step.passed)?.name, 'The update was saved');
  });
});
