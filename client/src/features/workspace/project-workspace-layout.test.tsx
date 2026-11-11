/**
 * The breadcrumb and document title are driven by one section list, so a
 * nested route missing from it silently loses its last crumb: that is how
 * `intelligence/execution` shipped with no breadcrumb at all.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ProjectWorkspaceLayout } from './project-workspace-layout';

vi.mock('./project-header', () => ({ ProjectHeader: () => null }));
vi.mock('./use-project-workspace', () => ({
  useProjectWorkspace: () => ({
    project: { id: 'p1', name: 'Clinic' },
    runs: [],
    notFound: false,
    isLoading: false,
    error: null,
  }),
}));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId/*" element={<ProjectWorkspaceLayout />}>
          <Route path="*" element={<p>section body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
}

describe('ProjectWorkspaceLayout breadcrumbs', () => {
  it('names the Execution subsection of Quality and Tests', () => {
    const crumbs = renderAt('/projects/p1/intelligence/execution');

    expect(crumbs.getByText('Execution')).toHaveAttribute('aria-current', 'page');
    expect(crumbs.getByRole('link', { name: 'Quality and Tests' })).toHaveAttribute(
      'href',
      '/projects/p1/intelligence',
    );
  });

  it('names a relabelled top-level section', () => {
    const crumbs = renderAt('/projects/p1/execution');
    expect(crumbs.getByText('Activity History')).toHaveAttribute('aria-current', 'page');
  });

  it('offers every section on the phone tab row, Agents included', () => {
    renderAt('/projects/p1/agents');
    const tabs = screen.getByRole('navigation', { name: 'Project sections' });
    expect(within(tabs).getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'href',
      '/projects/p1/agents',
    );
    expect(within(tabs).getAllByRole('link')).toHaveLength(13);
  });
});
