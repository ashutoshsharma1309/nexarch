/**
 * The console comes up, knows its own API is healthy, and renders Projects.
 *
 * This is the cheapest spec in the suite and the one most worth having: the
 * shell is code-split and route-lazy, the API status indicator is a live
 * poll, and the Projects list is a query — so "the page loaded" has silently
 * meant "the page loaded and three of its four moving parts failed" more
 * than once. Each of those parts is asserted separately here so a failure
 * names which one went.
 */
import { expect, test } from '@playwright/test';

import { skipWhenAppIsNotRunning, watchConsole } from './support/app';

test.describe('Console shell', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await skipWhenAppIsNotRunning(request, baseURL);
  });

  test('loads, reports the API operational, and renders the Projects list', async ({ page }) => {
    const output = watchConsole(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'NexArch' })).toBeVisible();

    // The indicator's first paint is "Checking API"; it resolves on the
    // health response. Asserting the resolved text is what makes this a
    // check of the API rather than of the badge.
    await expect(page.getByText('API operational')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Projects' })
      .click();

    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search projects' })).toBeVisible();

    // The list resolved. Both outcomes — project cards and the "No projects
    // yet" empty state — render an h3; the loading skeletons render none, so
    // this distinguishes "answered" from "still waiting", which a visible
    // page header does not.
    await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();

    // The console is this project's own code, so its console output is
    // entirely our responsibility and the bar is zero.
    expect(output.pageErrors).toEqual([]);
    expect(output.consoleErrors).toEqual([]);
  });
});
