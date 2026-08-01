/**
 * Sidebar tests: the navigation is the product's mental model, so the
 * rendered rail must carry every registered nav item (a nav-items entry
 * without a visible link is a dead feature), plus the attribution link.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { navigation } from '@/shared/nav-items';
import { Sidebar } from './sidebar';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders a link for every registered nav item, pointing at its route', () => {
    renderSidebar();
    for (const item of navigation) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.to);
    }
  });

  it('includes the Phase 13 destinations in the primary navigation', () => {
    renderSidebar();
    for (const label of ['Insights', 'Run', 'GitHub']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('credits the author with an outbound LinkedIn link', () => {
    renderSidebar();
    const credit = screen.getByRole('link', { name: /Made by Ashutosh Sharma/ });
    expect(credit).toHaveAttribute('href', 'https://www.linkedin.com/in/ashutoshsharma1309/');
    expect(credit).toHaveAttribute('target', '_blank');
  });
});
