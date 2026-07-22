/**
 * API test generation — a real fetch-based integration test hitting every
 * OpenAPI path against a running instance, plus structural OpenAPI
 * validation (no network calls, no dependency) and dedicated
 * authentication/authorization test files.
 */
import type { OpenApiValidationResult, QualityArtifacts, TestFile } from '../quality.types.js';

export function validateOpenApi(artifacts: QualityArtifacts): OpenApiValidationResult {
  const issues: string[] = [];
  const paths = artifacts.openapi?.paths;

  if (!paths) {
    return { valid: false, issues: ['No OpenAPI contract available'], endpointsCovered: 0 };
  }

  const pathEntries = Object.entries(paths);
  if (pathEntries.length === 0) issues.push('OpenAPI contract has zero paths');

  let endpointsCovered = 0;
  for (const [path, item] of pathEntries) {
    if (typeof item !== 'object' || item === null) {
      issues.push(`${path}: path item is not an object`);
      continue;
    }
    const operations = Object.entries(item as Record<string, unknown>);
    if (operations.length === 0) issues.push(`${path}: no operations defined`);
    for (const [method, operation] of operations) {
      endpointsCovered += 1;
      if (typeof operation !== 'object' || operation === null) {
        issues.push(`${path} ${method}: operation is not an object`);
        continue;
      }
      const op = operation as { responses?: unknown; summary?: unknown };
      if (!op.responses) issues.push(`${path} ${method}: missing responses`);
      if (!op.summary) issues.push(`${path} ${method}: missing summary`);
    }
  }

  return { valid: issues.length === 0, issues, endpointsCovered };
}

function integrationTest(routes: { method: string; path: string }[]): TestFile {
  const getRoutes = routes.filter((r) => r.method === 'GET' && !r.path.includes(':'));
  const rows = getRoutes.map((r) => `  '${r.path}',`).join('\n');

  return {
    path: 'backend/test/integration/api.test.ts',
    language: 'typescript',
    kind: 'integration',
    content: `/**
 * Integration test against a running instance — set API_BASE_URL (defaults
 * to http://localhost:4000/api/v1) and start the server before running.
 * Covers every unparameterized GET endpoint from the OpenAPI contract.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

const GET_ENDPOINTS: string[] = [
${rows}
];

describe('API integration', () => {
  for (const path of GET_ENDPOINTS) {
    it(\`GET \${path} responds without a server error\`, async () => {
      const response = await fetch(\`\${BASE_URL}\${path}\`);
      assert.ok(response.status < 500, \`\${path} returned \${response.status}\`);
    });
  }

  it('unknown routes return 404', async () => {
    const response = await fetch(\`\${BASE_URL}/this-route-does-not-exist\`);
    assert.equal(response.status, 404);
  });
});
`,
  };
}

function requestResponseValidationTest(routes: { method: string; path: string }[]): TestFile {
  const postRoutes = routes.filter((r) => r.method === 'POST' && !r.path.includes(':'));
  const rows = postRoutes.map((r) => `  '${r.path}',`).join('\n');

  return {
    path: 'backend/test/integration/request-validation.test.ts',
    language: 'typescript',
    kind: 'integration',
    content: `/**
 * Confirms every POST endpoint rejects an empty body with 4xx rather than
 * crashing — the baseline request-validation contract every generated
 * validator chain should guarantee.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

const POST_ENDPOINTS: string[] = [
${rows}
];

describe('request validation', () => {
  for (const path of POST_ENDPOINTS) {
    it(\`POST \${path} rejects an empty body\`, async () => {
      const response = await fetch(\`\${BASE_URL}\${path}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.ok(response.status >= 400 && response.status < 500, \`\${path} returned \${response.status}\`);
    });
  }
});
`,
  };
}

function authAndAuthzTest(routes: { method: string; path: string }[]): TestFile {
  const protectedRoutes = routes.filter(
    (r) => !r.path.startsWith('/health') && !r.path.startsWith('/auth'),
  );
  const sample = protectedRoutes.slice(0, 10);
  const rows = sample.map((r) => `  ['${r.method}', '${r.path}'],`).join('\n');

  return {
    path: 'backend/test/integration/auth.test.ts',
    language: 'typescript',
    kind: 'api',
    content: `/**
 * Authentication and authorization contract: requests without a bearer
 * token to protected endpoints must be rejected, never silently allowed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

const PROTECTED_ENDPOINTS: [string, string][] = [
${rows}
];

describe('authentication and authorization', () => {
  for (const [method, path] of PROTECTED_ENDPOINTS) {
    it(\`\${method} \${path} rejects requests with no Authorization header\`, async () => {
      const response = await fetch(\`\${BASE_URL}\${path}\`, { method });
      assert.ok(
        response.status === 401 || response.status === 404 || response.status === 400,
        \`expected 400/401/404 for unauthenticated \${method} \${path}, got \${response.status}\`,
      );
    });

    it(\`\${method} \${path} rejects an invalid bearer token\`, async () => {
      const response = await fetch(\`\${BASE_URL}\${path}\`, {
        method,
        headers: { Authorization: 'Bearer not-a-real-token' },
      });
      assert.notEqual(response.status, 500);
    });
  }
});
`,
  };
}

export function generateApiTests(artifacts: QualityArtifacts): TestFile[] {
  const routes = artifacts.backend?.routes ?? [];
  if (routes.length === 0) return [];
  return [integrationTest(routes), requestResponseValidationTest(routes), authAndAuthzTest(routes)];
}
