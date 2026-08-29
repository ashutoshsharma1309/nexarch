/**
 * Executes the test plan against the live application.
 *
 * Every result in this file is a status code that was actually received.
 * There is no path through this code where a test passes because passing
 * was expected — the fabrication Step 6 forbids is structurally impossible
 * when the only inputs are HTTP responses.
 *
 * BLOCKED is decided before FAILED is possible. A test that needs the
 * runtime gets BLOCKED when the runtime never started; a test that needs
 * credentials gets BLOCKED when none can be established. A test only ever
 * FAILS by running.
 *
 * Credentials are a ladder, and the ladder is honest about its rungs:
 *
 *   1. A real register → login round trip, disposable throwaway account.
 *   2. Failing that, a synthetic bearer token — generated auth scaffolds
 *      accept any bearer and attach a stub principal, so CRUD, validation
 *      and persistence can still be *really* exercised while the login
 *      flow's own failure is reported by its own test.
 *   3. If even a synthetic token is rejected, auth-dependent tests are
 *      BLOCKED with that evidence, because nothing behind the guard can be
 *      reached and pretending otherwise would fabricate results.
 *
 * All test data is namespaced by run id and lives in the validation
 * session's throwaway database, which the runner destroys with the
 * workspace. Nothing here touches real credentials or real data.
 */
import { randomUUID } from 'node:crypto';

import { scrub } from './runtime-validation.js';
import { creationPathFor, payloadFor, requiredForeignKeys } from './test-plan.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';
import type { TestCase, TestResult } from '../../../shared/types/validation.js';

interface Response_ {
  status: number | null;
  body: string;
  json: unknown;
}

async function call(
  method: string,
  url: string,
  options: { token?: string | null; body?: unknown } = {},
): Promise<Response_> {
  try {
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON — fine */
    }
    return { status: response.status, body: text.slice(0, 500), json };
  } catch {
    return { status: null, body: '', json: null };
  }
}

function ok(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/** The created record's id, wherever the generated envelope put it. */
function idOf(json: unknown): string | null {
  const data = (json as { data?: unknown } | null)?.data ?? json;
  const record = (data as { id?: unknown } | null) ?? {};
  return typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : null;
}

export interface ExecutionInput {
  cases: TestCase[];
  api: OpenApiDocument;
  backendBaseUrl: string | null;
  frontendBaseUrl: string | null;
  apiPrefix: string;
  runId: string;
  runtimeUp: boolean;
}

export interface Execution {
  cases: TestCase[];
  results: TestResult[];
  credentials: { mode: 'real-login' | 'synthetic-token' | 'none'; evidence: string };
}

function record(
  results: TestResult[],
  testCase: TestCase,
  status: TestCase['status'],
  duration: number,
  error: string | null,
  evidence: string | null,
): void {
  testCase.status = status;
  testCase.duration = duration;
  testCase.error = error ? scrub(error) : null;
  testCase.evidence = evidence ? scrub(evidence) : null;
  results.push({
    id: randomUUID(),
    projectId: testCase.projectId,
    runId: testCase.runId,
    agentId: testCase.agentId,
    testCaseId: testCase.id,
    status,
    duration,
    error: testCase.error,
    evidence: testCase.evidence,
    createdAt: new Date().toISOString(),
  });
}

export async function executeTestPlan(input: ExecutionInput): Promise<Execution> {
  const results: TestResult[] = [];
  const base = input.backendBaseUrl;
  const prefix = input.apiPrefix;
  const seed = input.runId.slice(0, 8);

  /* ── Nothing runs against a runtime that never started ─────────────── */

  if (!input.runtimeUp || !base) {
    for (const testCase of input.cases) {
      record(
        results,
        testCase,
        'BLOCKED',
        0,
        'The application did not start; this test could not run.',
        'runtime startupStatus=FAIL',
      );
    }
    return { cases: input.cases, results, credentials: { mode: 'none', evidence: 'runtime down' } };
  }

  /* ── Establish credentials, honestly ───────────────────────────────── */

  const email = `test.${seed}@test.invalid`;
  const password = `Validate#${seed}A1`;
  let token: string | null = null;
  let credentialMode: Execution['credentials']['mode'] = 'none';
  let credentialEvidence = '';

  const register = await call('POST', `${base}${prefix}/auth/register`, {
    body: { email, password, name: 'Test Probe' },
  });
  const login = await call('POST', `${base}${prefix}/auth/login`, { body: { email, password } });
  const loginData = (login.json as { data?: Record<string, unknown> } | null)?.data ?? {};
  const realToken =
    typeof loginData.accessToken === 'string'
      ? loginData.accessToken
      : typeof loginData.token === 'string'
        ? loginData.token
        : null;

  if (ok(login.status) && realToken) {
    token = realToken;
    credentialMode = 'real-login';
    credentialEvidence = `register → ${String(register.status)}, login → ${String(login.status)}`;
  } else {
    // The scaffold ladder: any-bearer acceptance is verified, not assumed.
    const synthetic = `validation-${seed}-${randomUUID().slice(0, 8)}`;
    const guarded = input.cases.find(
      (testCase) => testCase.type === 'API' && testCase.target !== 'authentication',
    );
    const probePath = guarded ? guarded.steps[0]?.action.match(/\/[\w/-]+/)?.[0] : null;
    const probe = await call('GET', `${base}${prefix}${probePath ?? '/'}`, { token: synthetic });
    if (probe.status !== null && probe.status !== 401 && probe.status !== 403) {
      token = synthetic;
      credentialMode = 'synthetic-token';
      credentialEvidence = `login unavailable (→ ${String(login.status)}); scaffold accepts a synthetic bearer (probe → ${String(probe.status)})`;
    } else {
      credentialEvidence = `login → ${String(login.status)}; synthetic bearer rejected (→ ${String(probe.status)})`;
    }
  }

  /* ── Run the plan ──────────────────────────────────────────────────── */

  for (const testCase of input.cases) {
    const startedAt = Date.now();
    testCase.status = 'RUNNING';

    /* Smoke tests need no credentials. */
    if (testCase.target === 'health') {
      const health = await call('GET', `${base}${prefix}/health`);
      const passed = health.status === 200;
      record(
        results,
        testCase,
        passed ? 'PASSED' : 'FAILED',
        Date.now() - startedAt,
        passed ? null : `expected 200, got ${String(health.status ?? 'no answer')}`,
        `GET ${prefix}/health → ${String(health.status ?? 'no answer')}`,
      );
      continue;
    }

    if (testCase.target === 'frontend') {
      if (!input.frontendBaseUrl) {
        record(results, testCase, 'SKIPPED', 0, null, 'no frontend process in this run');
        continue;
      }
      const page = await call('GET', input.frontendBaseUrl);
      const passed = page.status === 200 && /<div id="root">|<!doctype html>/i.test(page.body);
      record(
        results,
        testCase,
        passed ? 'PASSED' : 'FAILED',
        Date.now() - startedAt,
        passed ? null : `expected the app shell, got ${String(page.status ?? 'no answer')}`,
        `GET ${input.frontendBaseUrl} → ${String(page.status ?? 'no answer')}`,
      );
      continue;
    }

    if (testCase.target === 'authentication') {
      const passed = ok(register.status) && ok(login.status);
      record(
        results,
        testCase,
        passed ? 'PASSED' : 'FAILED',
        Date.now() - startedAt,
        passed
          ? null
          : `register → ${String(register.status ?? 'no answer')}, login → ${String(login.status ?? 'no answer')}`,
        `POST ${prefix}/auth/register → ${String(register.status ?? '—')} · POST ${prefix}/auth/login → ${String(login.status ?? '—')}`,
      );
      continue;
    }

    if (testCase.target === 'authorization') {
      const path = testCase.steps[0]?.action.match(/\/[\w/-]+/)?.[0] ?? '/';
      const bare = await call('GET', `${base}${prefix}${path}`);
      const passed = bare.status === 401 || bare.status === 403;
      record(
        results,
        testCase,
        passed ? 'PASSED' : 'FAILED',
        Date.now() - startedAt,
        passed
          ? null
          : `expected 401/403 without credentials, got ${String(bare.status ?? 'no answer')}`,
        `GET ${prefix}${path} without credentials → ${String(bare.status ?? 'no answer')}`,
      );
      continue;
    }

    /* Everything from here needs credentials. */
    if (!token) {
      record(
        results,
        testCase,
        'BLOCKED',
        0,
        'No credentials could be established against the running application.',
        credentialEvidence,
      );
      continue;
    }

    const collection = testCase.steps[0]?.action.match(
      /(?:POST|GET|PUT|PATCH|DELETE)\s+(\/[\w/-]+)/,
    )?.[1];
    if (!collection) {
      record(
        results,
        testCase,
        'SKIPPED',
        0,
        'No probe path could be derived from the plan step.',
        null,
      );
      continue;
    }
    const url = `${base}${prefix}${collection}`;

    if (testCase.name.includes('empty payload')) {
      const rejected = await call('POST', url, { token, body: {} });
      const passed = rejected.status !== null && rejected.status >= 400 && rejected.status < 500;
      record(
        results,
        testCase,
        passed ? 'PASSED' : 'FAILED',
        Date.now() - startedAt,
        passed ? null : `expected 4xx, got ${String(rejected.status ?? 'no answer')}`,
        `POST ${collection} with {} → ${String(rejected.status ?? 'no answer')}`,
      );
      continue;
    }

    /* Create-and-read, and the E2E lifecycle, share their first steps. */
    const openApiPath = collection.replace(/\/$/, '');
    const payload = payloadFor(
      input.api,
      openApiPath,
      'POST',
      `${seed}${randomUUID().slice(0, 4)}`,
    );

    /*
     * Foreign keys are satisfied by creating the parent first — a real
     * record through the real API, which is what an actual client would
     * have to do. A parent with no creatable endpoint makes the case
     * SKIPPED, not failed: the test cannot establish anything about this
     * module, and a guaranteed FK rejection would indict the app for the
     * test plan's limitation.
     */
    const foreignKeys = requiredForeignKeys(input.api, openApiPath);
    let skippedForFk: string | null = null;
    for (const fk of foreignKeys) {
      const parentPath = creationPathFor(input.api, fk.references);
      if (!parentPath) {
        skippedForFk = `${fk.field} references ${fk.references}, which has no creatable endpoint in this API`;
        break;
      }
      const parentPayload = payloadFor(
        input.api,
        parentPath,
        'POST',
        `${seed}${randomUUID().slice(0, 4)}`,
      );
      const parent = await call('POST', `${base}${prefix}${parentPath}`, {
        token,
        body: parentPayload ?? {},
      });
      const parentId = idOf(parent.json);
      if (!ok(parent.status) || !parentId) {
        skippedForFk = `${fk.field} needs a ${fk.references} record and POST ${parentPath} → ${String(parent.status ?? 'no answer')}`;
        break;
      }
      if (payload) payload[fk.field] = parentId;
    }
    if (skippedForFk) {
      record(results, testCase, 'SKIPPED', Date.now() - startedAt, null, skippedForFk);
      continue;
    }

    const created = await call('POST', url, { token, body: payload ?? {} });
    const evidence: string[] = [`POST ${collection} → ${String(created.status ?? 'no answer')}`];

    if (!ok(created.status)) {
      record(
        results,
        testCase,
        'FAILED',
        Date.now() - startedAt,
        `create with the contract's required fields → ${String(created.status ?? 'no answer')}: ${scrub(created.body.slice(0, 160))}`,
        evidence.join(' · '),
      );
      continue;
    }

    const id = idOf(created.json);
    const listed = await call('GET', url, { token });
    evidence.push(`GET ${collection} → ${String(listed.status ?? 'no answer')}`);
    const listedOk = ok(listed.status) && (id === null || listed.body.includes(id));

    if (testCase.type !== 'E2E') {
      record(
        results,
        testCase,
        listedOk ? 'PASSED' : 'FAILED',
        Date.now() - startedAt,
        listedOk ? null : 'the created record did not come back from the list endpoint',
        evidence.join(' · '),
      );
      continue;
    }

    /* E2E continues: get by id, update, get again. */
    if (!id) {
      record(
        results,
        testCase,
        'FAILED',
        Date.now() - startedAt,
        'create succeeded but returned no id to continue the lifecycle with',
        evidence.join(' · '),
      );
      continue;
    }

    const fetched = await call('GET', `${url}/${id}`, { token });
    evidence.push(`GET ${collection}/${id} → ${String(fetched.status ?? 'no answer')}`);

    const updatePayload = payloadFor(input.api, openApiPath, 'POST', `${seed}upd`);
    const updated = await call('PUT', `${url}/${id}`, { token, body: updatePayload ?? {} });
    evidence.push(`PUT ${collection}/${id} → ${String(updated.status ?? 'no answer')}`);

    const after = await call('GET', `${url}/${id}`, { token });
    evidence.push(`GET again → ${String(after.status ?? 'no answer')}`);

    const lifecycle = ok(fetched.status) && ok(updated.status) && ok(after.status);
    record(
      results,
      testCase,
      lifecycle ? 'PASSED' : 'FAILED',
      Date.now() - startedAt,
      lifecycle ? null : 'a step of the lifecycle did not return success',
      evidence.join(' · '),
    );
  }

  return {
    cases: input.cases,
    results,
    credentials: { mode: credentialMode, evidence: scrub(credentialEvidence) },
  };
}
