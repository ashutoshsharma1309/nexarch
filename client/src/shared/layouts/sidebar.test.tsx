/**
 * Sidebar tests: the navigation is the product's mental model, so the
 * rendered rail must carry every registered nav item (a nav-items entry
 * without a visible link is a dead feature), and nothing else.
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

  it('keeps the primary navigation to the three product-level destinations', () => {
    // The rail used to carry one entry per internal module. Everything else
    // now lives inside the project it belongs to, and a regression here
    // would mean the workspace has started leaking back out into the shell.
    renderSidebar();
    const links = screen
      .getAllByRole('link')
      .map((link) => link.textContent.trim())
      .filter((label) => !label.startsWith('Made by'));
    expect(links).toEqual(['Home', 'Projects', 'Settings']);
  });

  it('credits the author with an outbound LinkedIn link', () => {
    renderSidebar();
    const credit = screen.getByRole('link', { name: /Made by Ashutosh Sharma/ });
    expect(credit).toHaveAttribute('href', 'https://www.linkedin.com/in/ashutoshsharma1309/');
    expect(credit).toHaveAttribute('target', '_blank');
  });
});
