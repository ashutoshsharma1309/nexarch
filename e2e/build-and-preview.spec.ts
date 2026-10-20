/**
 * The whole product, once: a prompt becomes a project, the project builds,
 * and the built project runs in the preview frame.
 *
 * This is the flow that broke. A build reported every stage completed, the
 * preview session reached `running`, the server's own validation passed —
 * and the iframe was blank, because the generated app had two copies of
 * React and threw "Incompatible React versions" on mount. Nothing in the
 * DOM said so; the only witness was the browser console inside the frame.
 * That is why this spec asserts on console output as strictly as it asserts
 * on the rendered `<h1>`.
 *
 * It needs a server with a real AI key and it writes to the workspace, so it
 * cannot run in CI. See `.github/workflows/ci.yml`.
 */
import { expect, test } from '@playwright/test';

import { skipWhenAppIsNotRunning, watchConsole } from './support/app';

/**
 * Long enough to describe a real application (the Build form requires 20
 * characters) and narrow enough that the generated app has an unambiguous
 * landing page to assert on.
 */
const PROMPT =
  'A task tracker where a signed-in user can create tasks, assign them to a ' +
  'project, mark them complete, and see a dashboard of what is still open.';

/** The exact message the duplicate-React regression printed. */
const REACT_VERSION_ERROR = 'Incompatible React versions';

test.describe('Build and preview', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await skipWhenAppIsNotRunning(request, baseURL);
  });

  test('builds a project from a prompt and renders it in the preview frame', async ({ page }) => {
    /*
     * Observed on the development machine: a build runs 20–90s and the
     * preview's first `npm install` of the generated project runs 40–120s,
     * both single-threaded against one dev server. Twelve minutes is
     * headroom over the worst case seen, not a guess at the normal path —
     * and the assertions below all wait on conditions, so a fast run
     * finishes fast regardless of this ceiling.
     */
    test.setTimeout(12 * 60 * 1000);

    const output = watchConsole(page);
    const projectName = `e2e ${new Date().toISOString()}`;

    await page.goto('/projects');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill(projectName);
    await page.getByRole('button', { name: 'Create project' }).click();

    // Creating a project navigates into its workspace.
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);

    const sections = page.getByRole('navigation', { name: 'Project sections' });
    await sections.getByRole('link', { name: 'Build' }).click();

    const prompt = page.getByLabel('What should this project be?');
    await expect(prompt).toBeVisible();
    await prompt.fill(PROMPT);
    await page.getByRole('button', { name: 'Build project' }).click();

    /*
     * "Build complete" is the server's own verdict, rendered from the run's
     * status — not a stage count this spec adds up for itself. Waiting on it
     * is what keeps this condition-based: no sleep anywhere in the flow.
     */
    const progress = page.getByRole('region', { name: 'Build progress' });
    await expect(progress.getByRole('heading', { level: 2, name: 'Build complete' })).toBeVisible({
      timeout: 5 * 60 * 1000,
    });
    await expect(progress.locator('li[data-status="failed"]')).toHaveCount(0);

    await sections.getByRole('link', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Run preview' }).first().click();

    /*
     * The preview page switches itself to the Live app tab once the session
     * reaches `running`, so the frame appearing *is* the signal that the
     * install and both dev servers came up.
     */
    const frameSelector = 'iframe[title$=" preview"]';
    await expect(page.locator(frameSelector)).toBeVisible({ timeout: 6 * 60 * 1000 });

    // A real heading with real text. `toBeVisible` alone would pass on an
    // empty `<h1>`, which is what a half-mounted React tree leaves behind.
    const heading = page.frameLocator(frameSelector).locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 90_000 });
    await expect(heading).not.toHaveText('');

    // Named explicitly so this failure is reported by name rather than as
    // "an unexpected console error".
    expect(
      [...output.consoleErrors, ...output.pageErrors].filter((line) =>
        line.includes(REACT_VERSION_ERROR),
      ),
    ).toEqual([]);

    /*
     * Uncaught exceptions are held to zero across both the console and the
     * generated app in the frame: an unhandled throw during mount is exactly
     * what produced the blank preview. Error-level *console* output is not
     * asserted empty here, because some of it comes from the generated
     * project's own dependencies rather than from anything this repo
     * controls, and an assertion that fails for reasons we cannot fix is an
     * assertion people learn to ignore.
     */
    expect(output.pageErrors).toEqual([]);
  });
});
