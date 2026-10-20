/**
 * Playwright configuration for the end-to-end suite in `e2e/`.
 *
 * These specs drive the real console against a real server — a real Postgres,
 * a real AI key, real `npm install`s inside generated projects. There is
 * deliberately no `webServer` block: starting the stack needs secrets this
 * config has no business knowing, and a half-configured auto-start would fail
 * in a way that looks like a product regression. The specs probe the base URL
 * themselves and skip with an explanation when nothing is listening
 * (see `e2e/support/app.ts`).
 *
 * Everything here is sized for one developer laptop with 8 GB of RAM running
 * one dev server: a single worker, no parallelism, no retries. Two workers
 * would race for the runner's port allocations and the machine's memory, and
 * retries on a flow that takes minutes turn a red run into a lunch break.
 */
import { defineConfig, devices } from '@playwright/test';

/** Overridable so the suite can be pointed at a staging deployment. */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/**
 * Where the HTML report, traces and failure screenshots land.
 *
 * The directory is named `build` on purpose: the repo's `.prettierignore`
 * already excludes any directory by that name at any depth, and the report is
 * a 200 KB HTML file that `npm run format:check` would otherwise flag on
 * every run after a local test run. Generated output under a `build/`
 * directory is also just what the name means.
 */
const ARTIFACTS = 'e2e/build';

export default defineConfig({
  testDir: './e2e',
  outputDir: `${ARTIFACTS}/test-results`,

  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),

  /**
   * The per-test default covers the console-level flows. The two specs that
   * wait on a build or an `npm install` raise it themselves, with the
   * observed durations written down beside the number.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [['list'], ['html', { outputFolder: `${ARTIFACTS}/report`, open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Kept on failure only: a trace of a five-minute build is large.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Chromium only. The generated previews are judged in one engine; adding
  // Firefox and WebKit would triple a suite that is already minutes long
  // without testing anything this project ships.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
