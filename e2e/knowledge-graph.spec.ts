/**
 * The Knowledge Graph renders, narrows, and explains a node.
 *
 * The graph has failed in three distinct ways in this project: nodes that
 * never painted because the canvas mounted at zero height, a search that
 * filtered the data but not the count beside it, and a details panel that
 * opened empty because the node request used a different id than the canvas
 * did. One assertion each, in the order a person meets them.
 *
 * It reads a project that has already been built rather than building one —
 * see `findProjectWithGraph` — so it is slow but not AI-expensive.
 */
import { expect, test } from '@playwright/test';

import {
  chooseNarrowingSearch,
  findProjectWithGraph,
  readNodeCounter,
  skipWhenAppIsNotRunning,
} from './support/app';

test.describe('Knowledge Graph', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await skipWhenAppIsNotRunning(request, baseURL);
  });

  test('renders nodes, narrows them by search, and shows a node’s details', async ({
    page,
    request,
  }) => {
    // Laying out a few hundred nodes and fetching the selected node's
    // neighbourhood is slower than a console page but nothing like a build.
    test.slow();

    const graph = await findProjectWithGraph(request);
    if (graph === null) {
      test.skip(
        true,
        'No project in this workspace has a built graph yet. Build one in the ' +
          'console (or run the build-and-preview spec) and run this again.',
      );
      return;
    }

    const search = chooseNarrowingSearch(graph);
    if (search === null) {
      test.skip(
        true,
        `The graph for project ${graph.projectId} has no search term that leaves ` +
          'any node out — every node is within one hop of every match — so there ' +
          'is nothing for a narrowing assertion to observe.',
      );
      return;
    }

    /*
     * `view=all` rather than the default Architecture view: the default
     * filters by node type, so the toolbar's "visible/total" would already
     * be narrowed before the search ran and the assertion below would be
     * measuring the view mode instead of the search.
     */
    await page.goto(`/projects/${graph.projectId}/graph?view=all`);

    const nodes = page.locator('.react-flow__node');
    await expect(nodes.first()).toBeVisible();

    const counter = page.getByText(/\d+\s*\/\s*\d+\s+nodes/);
    await expect(counter).toBeVisible();

    const beforeText = await counter.innerText();
    const before = readNodeCounter(beforeText);
    expect(before, `the toolbar should report a node count, got "${beforeText}"`).not.toBeNull();
    if (before === null) return;
    expect(before.visible).toBe(before.total);

    await page.getByRole('textbox', { name: 'Search graph nodes' }).fill(search);

    /*
     * Condition-based: the count is read back until it has dropped, so this
     * waits for the filter to land without waiting a fixed amount of time
     * for it. The term was chosen (from the graph the API returned) so that
     * a drop is possible at all; what is asserted is what the UI shows.
     */
    await expect
      .poll(async () => readNodeCounter(await counter.innerText())?.visible ?? before.visible)
      .toBeLessThan(before.visible);

    const after = readNodeCounter(await counter.innerText());
    expect(after).not.toBeNull();
    if (after === null) return;
    // Narrowed, not emptied, and the denominator still describes the project.
    expect(after.visible).toBeGreaterThan(0);
    expect(after.total).toBe(before.total);
    await expect(nodes.first()).toBeVisible();

    await nodes.first().click();

    /*
     * The details panel is the one place the graph claims to know something
     * specific about a node. Its heading is the node's name and its first
     * badge is the canonical id the server keyed it by — an empty panel with
     * a close button used to satisfy a laxer assertion than this.
     */
    const details = page.getByRole('button', { name: 'Close details' });
    await expect(details).toBeVisible();
    await expect(page.getByText(/^id: \S/)).toBeVisible();
    // Selection is URL state, so a details panel implies a shareable link.
    await expect(page).toHaveURL(/[?&]node=/);
  });
});
