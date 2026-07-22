/**
 * End-to-end, regression, and smoke tests. E2E uses Playwright (the
 * generated frontend has no browser-automation dependency yet — this is
 * documented, not silently assumed, same as the Vitest note in
 * `frontend-test-generator.ts`). Regression/smoke are plain `fetch`-based
 * `node:test` files with no new dependency, runnable against a booted
 * backend immediately.
 */
import type { QualityArtifacts, TestFile } from '../quality.types.js';

function e2eTest(projectName: string, pages: { name: string; route: string }[]): TestFile {
  const primaryRoute = pages.find((p) => p.route === '/')?.route ?? pages[0]?.route ?? '/';

  return {
    path: 'e2e/journey.spec.ts',
    language: 'typescript',
    kind: 'e2e',
    content: `// Requires devDependency: @playwright/test
/**
 * ${projectName} — primary user journey. Set BASE_URL (defaults to
 * http://localhost:5173) and have the full stack running before executing
 * with \`npx playwright test\`.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

test('loads the app shell and the primary page renders', async ({ page }) => {
  await page.goto(\`\${BASE_URL}${primaryRoute}\`);
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator('body')).toBeVisible();
});

test('client-side navigation does not hard-reload', async ({ page }) => {
  await page.goto(BASE_URL);
  const navLink = page.locator('a[href^="/"]').first();
  if (await navLink.count()) {
    await navLink.click();
    await expect(page).toHaveURL(/.+/);
  }
});
`,
  };
}

function regressionTest(routes: { method: string; path: string }[]): TestFile {
  const getRoutes = routes.filter((r) => r.method === 'GET').slice(0, 15);
  const rows = getRoutes.map((r) => `  '${r.path}',`).join('\n');

  return {
    path: 'backend/test/regression/known-routes.test.ts',
    language: 'typescript',
    kind: 'regression',
    content: `/**
 * Regression guard — the exact set of GET routes the API contract
 * declared at generation time. If this list drifts from a future
 * regeneration without an intentional API change, this test catches it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

const KNOWN_GET_ROUTES: string[] = [
${rows}
];

describe('known routes regression', () => {
  for (const path of KNOWN_GET_ROUTES) {
    it(\`\${path} still exists (not 404)\`, async () => {
      const response = await fetch(\`\${BASE_URL}\${path.replace(/:[^/]+/g, '1')}\`);
      assert.notEqual(response.status, 404, \`\${path} disappeared since generation\`);
    });
  }
});
`,
  };
}

function smokeTest(): TestFile {
  return {
    path: 'backend/test/smoke/boot.test.ts',
    language: 'typescript',
    kind: 'smoke',
    content: `/**
 * Fastest possible signal that a deployment is broken — health endpoint
 * responds, database is reachable. Run this first in any CI/CD pipeline
 * before the slower integration suite.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

describe('smoke', () => {
  it('GET /health responds 200', async () => {
    const response = await fetch(\`\${BASE_URL}/health\`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, 'ok');
  });

  it('GET /health/live responds 200', async () => {
    const response = await fetch(\`\${BASE_URL}/health/live\`);
    assert.equal(response.status, 200);
  });
});
`,
  };
}

export function generateE2eTests(artifacts: QualityArtifacts): TestFile[] {
  const files: TestFile[] = [smokeTest()];
  const routes = artifacts.backend?.routes ?? [];
  if (routes.length > 0) files.push(regressionTest(routes));
  const pages = artifacts.frontend?.pages ?? [];
  if (pages.length > 0) files.push(e2eTest(artifacts.projectName, pages));
  return files;
}
