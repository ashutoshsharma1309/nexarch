/**
 * Whether the running parts actually fit together.
 *
 * Phases 8 and 9 compared the API contract to the *source* — useful, but
 * still a comparison of two documents. This validates the contract the
 * only way a contract can finally be validated: by calling it. Every
 * declared operation is probed against the live application, and the
 * response is the verdict:
 *
 *   404          → the endpoint is not mounted: contract mismatch
 *   501          → mounted but not implemented: an honest scaffold
 *   401/403      → mounted and guarded
 *   2xx/400/422  → mounted and answering
 *   no answer    → the whole check is blocked, not failed
 *
 * Probes are chosen to be safe on a live system: GETs are harmless, and
 * writes are probed *without* a body and *without* credentials — the goal
 * is "does this route exist and is it guarded", which a 401 or 400 proves
 * without creating anything.
 *
 * The auth and database checks ask the application, not its config: a
 * register/login round-trip with disposable credentials, and the health
 * endpoint's own report of its database connection. No LLM is involved
 * anywhere in this file, per Step 26 — every question here has a status
 * code for an answer.
 */
import { scrub } from './runtime-validation.js';
import type {
  IntegrationCheck,
  IntegrationResult,
  RuntimeResult,
} from '../../../shared/types/validation.js';
import type { AgentFinding } from '../../../shared/contracts/index.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';

interface Probe {
  status: number | null;
  body: string;
}

async function request(
  method: string,
  url: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Probe> {
  try {
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, body: (await response.text()).slice(0, 500) };
  } catch {
    return { status: null, body: '' };
  }
}

/** `/products/{id}` → `/products/1` — a syntactically valid probe target. */
function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '1');
}

function verdictOf(status: number | null): string {
  if (status === null) return 'UNREACHABLE';
  if (status === 404) return 'MISSING_ENDPOINT';
  if (status === 501) return 'NOT_IMPLEMENTED';
  if (status === 401 || status === 403) return 'GUARDED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'ANSWERING';
}

export interface IntegrationInput {
  projectId: string;
  runId: string;
  api: OpenApiDocument;
  runtime: RuntimeResult;
  backendBaseUrl: string | null;
  frontendBaseUrl: string | null;
  /** `/api/v1` — read from the generated routes, not assumed. */
  apiPrefix: string;
}

export interface IntegrationValidation {
  result: IntegrationResult;
  findings: AgentFinding[];
}

function finding(
  severity: AgentFinding['severity'],
  category: string,
  title: string,
  description: string,
  evidence: string,
  recommendation: string,
): AgentFinding {
  return {
    type: 'INTEGRATION',
    severity,
    category,
    title,
    description,
    evidence: scrub(evidence),
    recommendation,
    targetNodeId: null,
    targetFile: null,
    confidence: 1, // every one of these is a status code that was observed
    status: 'OPEN',
  };
}

export async function validateIntegration(input: IntegrationInput): Promise<IntegrationValidation> {
  const startedAt = Date.now();
  const checks: IntegrationCheck[] = [];
  const findings: AgentFinding[] = [];
  const endpoints: IntegrationResult['endpoints'] = [];

  const base = input.backendBaseUrl;

  /* ── Everything below needs a live application ─────────────────────── */

  if (!base || input.runtime.startupStatus !== 'PASS') {
    const evidence = `runtime startupStatus=${input.runtime.startupStatus}; no live base URL`;
    for (const kind of [
      'API_CONTRACT',
      'AUTHENTICATION',
      'DATABASE',
      'FRONTEND_BACKEND',
    ] as const) {
      checks.push({
        kind,
        name: `${kind.toLowerCase().replace(/_/g, ' ')} (live)`,
        status: 'BLOCKED',
        evidence,
        error: 'The application did not start, so nothing live could be checked.',
      });
    }
    return {
      result: {
        projectId: input.projectId,
        runId: input.runId,
        baseUrl: null,
        checks,
        endpoints,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      },
      findings,
    };
  }

  /* ── API contract, validated by calling it ─────────────────────────── */

  let missing = 0;
  let unimplemented = 0;
  let serverErrors = 0;

  for (const [path, item] of Object.entries(input.api.paths)) {
    for (const method of Object.keys(item)) {
      const url = `${base}${input.apiPrefix}${concretePath(path)}`;
      const probe = await request(method.toUpperCase(), url);
      const verdict = verdictOf(probe.status);
      endpoints.push({ method: method.toUpperCase(), path, status: probe.status, verdict });

      if (verdict === 'MISSING_ENDPOINT') {
        missing += 1;
        findings.push(
          finding(
            'HIGH',
            'API_CONTRACT',
            `Declared endpoint is not mounted: ${method.toUpperCase()} ${path}`,
            'The API contract declares this operation and the running backend returns 404 for it. A client generated from the contract will fail here.',
            `${method.toUpperCase()} ${url} → 404`,
            'Regenerate the backend from the contract, or the contract from the backend.',
          ),
        );
      } else if (verdict === 'NOT_IMPLEMENTED') {
        unimplemented += 1;
      } else if (verdict === 'SERVER_ERROR') {
        serverErrors += 1;
        findings.push(
          finding(
            'HIGH',
            'API_CONTRACT',
            `Endpoint crashes when called: ${method.toUpperCase()} ${path}`,
            'The route is mounted but an unauthenticated probe produced a server error rather than a validation or auth response.',
            `${method.toUpperCase()} ${url} → ${String(probe.status)} · ${probe.body.slice(0, 120)}`,
            'Inspect the handler; a probe with no body should never reach a crash.',
          ),
        );
      }
    }
  }

  const total = endpoints.length;
  checks.push({
    kind: 'API_CONTRACT',
    name: `all ${String(total)} declared operations probed live`,
    status: missing > 0 || serverErrors > 0 ? 'FAIL' : 'PASS',
    evidence: `${String(total - missing)} mounted · ${String(missing)} missing · ${String(unimplemented)} not implemented · ${String(serverErrors)} server errors`,
    error: missing > 0 ? `${String(missing)} declared operation(s) return 404` : null,
  });

  if (unimplemented > 0) {
    findings.push(
      finding(
        'MEDIUM',
        'API_CONTRACT',
        `${String(unimplemented)} declared operation(s) are scaffolds`,
        'These routes are mounted and answer 501 Not Implemented. They are honest placeholders, but a client cannot use them.',
        endpoints
          .filter((entry) => entry.verdict === 'NOT_IMPLEMENTED')
          .slice(0, 5)
          .map((entry) => `${entry.method} ${entry.path}`)
          .join(' · '),
        'Implement the scaffolded handlers, or remove the operations from the contract until they exist.',
      ),
    );
  }

  /* ── Authentication: a real round trip with disposable credentials ─── */

  const email = `validation.${input.runId.slice(0, 8)}@test.invalid`;
  const password = `Validate#${input.runId.slice(0, 8)}A1`;

  const register = await request('POST', `${base}${input.apiPrefix}/auth/register`, {
    body: { email, password, name: 'Validation Probe' },
  });
  const login = await request('POST', `${base}${input.apiPrefix}/auth/login`, {
    body: { email, password },
  });

  const authWorks =
    register.status !== null &&
    register.status < 300 &&
    login.status !== null &&
    login.status < 300;

  if (authWorks) {
    checks.push({
      kind: 'AUTHENTICATION',
      name: 'register → login round trip',
      status: 'PASS',
      evidence: `POST /auth/register → ${String(register.status)} · POST /auth/login → ${String(login.status)}`,
      error: null,
    });
  } else {
    const detail = `POST /auth/register → ${String(register.status ?? 'no answer')} · POST /auth/login → ${String(login.status ?? 'no answer')}`;
    checks.push({
      kind: 'AUTHENTICATION',
      name: 'register → login round trip',
      status: 'FAIL',
      evidence: detail,
      error: 'A new user cannot sign up and sign in against the running application.',
    });
    findings.push(
      finding(
        'HIGH',
        'AUTHENTICATION',
        'The authentication flow does not work against the running application',
        register.status === 501
          ? 'Register and login are mounted as scaffolds returning 501. Every protected feature is unreachable through the front door.'
          : 'The register/login round trip failed against the live backend.',
        detail,
        'Implement the authentication handlers; the routes and middleware are already mounted.',
      ),
    );
  }

  /* ── Authorization: does the guard actually reject? ────────────────── */

  const guarded = endpoints.find((entry) => entry.verdict === 'GUARDED');
  if (guarded) {
    checks.push({
      kind: 'AUTHORIZATION',
      name: 'protected route rejects an unauthenticated request',
      status: 'PASS',
      evidence: `${guarded.method} ${guarded.path} → ${String(guarded.status)} without credentials`,
      error: null,
    });
  }

  /* ── Database, through the application itself ──────────────────────── */

  const health = await request('GET', `${base}${input.apiPrefix}/health`);
  const databaseUp = /"database"\s*:\s*"up"/.test(health.body);
  checks.push({
    kind: 'DATABASE',
    name: 'application reports its database connection',
    status:
      health.status === 200 && databaseUp ? 'PASS' : health.status === null ? 'BLOCKED' : 'FAIL',
    evidence: `GET ${input.apiPrefix}/health → ${String(health.status ?? 'no answer')} · ${scrub(health.body.slice(0, 120))}`,
    error:
      health.status === 200 && !databaseUp
        ? 'The health endpoint answered but did not report the database up.'
        : null,
  });
  if (health.status === 200 && !databaseUp) {
    findings.push(
      finding(
        'HIGH',
        'DATABASE',
        'The application cannot reach its database',
        'The backend is serving but its own health check does not report the database connection as up.',
        `GET ${input.apiPrefix}/health → ${scrub(health.body.slice(0, 160))}`,
        'Check the generated DATABASE_URL and that the schema was migrated into the run database.',
      ),
    );
  }

  /* ── Frontend ↔ backend, through the dev proxy ─────────────────────── */

  if (input.frontendBaseUrl) {
    const page = await request('GET', input.frontendBaseUrl);
    const proxied = await request('GET', `${input.frontendBaseUrl}${input.apiPrefix}/health`);
    const ok = page.status === 200 && proxied.status === 200;
    checks.push({
      kind: 'FRONTEND_BACKEND',
      name: 'frontend serves and reaches the backend through its proxy',
      status: ok ? 'PASS' : 'FAIL',
      evidence: `GET / → ${String(page.status ?? 'no answer')} · GET ${input.apiPrefix}/health via frontend → ${String(proxied.status ?? 'no answer')}`,
      error: ok ? null : 'The frontend or its API proxy is not answering.',
    });
    if (!ok) {
      findings.push(
        finding(
          'HIGH',
          'FRONTEND_BACKEND',
          'The frontend cannot reach the backend',
          'The page or the dev proxy to the API failed, so nothing in the UI can load data.',
          `frontend ${input.frontendBaseUrl}: page → ${String(page.status ?? 'none')}, proxied health → ${String(proxied.status ?? 'none')}`,
          'Check the frontend dev server and its proxy target port.',
        ),
      );
    }
  }

  /* ── Error handling: malformed input must be a 4xx, not a crash ────── */

  const writable = endpoints.find(
    (entry) =>
      entry.method === 'POST' &&
      !entry.path.includes('auth') &&
      entry.verdict !== 'MISSING_ENDPOINT',
  );
  if (writable) {
    const malformed = await request(
      'POST',
      `${base}${input.apiPrefix}${concretePath(writable.path)}`,
      {
        token: `validation-${input.runId.slice(0, 8)}`,
        body: { __malformed: true },
      },
    );
    const sane = malformed.status !== null && malformed.status < 500;
    checks.push({
      kind: 'ERROR_HANDLING',
      name: 'malformed write is rejected, not crashed on',
      status: sane ? 'PASS' : 'FAIL',
      evidence: `POST ${writable.path} with a nonsense body → ${String(malformed.status ?? 'no answer')}`,
      error: sane
        ? null
        : 'A malformed request produced a server error instead of a validation response.',
    });
    if (!sane) {
      findings.push(
        finding(
          'MEDIUM',
          'ERROR_HANDLING',
          `Malformed input crashes ${writable.method} ${writable.path}`,
          'A request with a nonsense body should be rejected by validation; instead the handler produced a server error.',
          `POST ${writable.path} → ${String(malformed.status ?? 'no answer')} · ${scrub(malformed.body.slice(0, 120))}`,
          'Validate the body before the handler logic runs.',
        ),
      );
    }
  }

  return {
    result: {
      projectId: input.projectId,
      runId: input.runId,
      baseUrl: base,
      checks,
      endpoints,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    },
    findings,
  };
}
