import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';

import { cn } from '@/shared/lib/cn';

export interface TabItem {
  to: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Only match when the URL is exactly `to` — for the index tab. */
  end?: boolean;
}

/**
 * Horizontal section bar, used by the workspace on screens without room for
 * the sidebar.
 *
 * Tabs are links, not buttons: each section of a project is a real URL, so
 * it can be bookmarked, opened in a new tab, and reached by the back button.
 * `NavLink`'s own `aria-current="page"` marks the active one.
 *
 * The row scrolls rather than wrapping, and the active tab is scrolled into
 * view on navigation. Nothing does that for free: with thirteen sections the
 * current one is otherwise off-screen on a phone.
 */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const row = scroller.current;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && active)
      row.scrollLeft = active.offsetLeft - row.clientWidth / 2 + active.offsetWidth / 2;
  }, [pathname]);

  return (
    <div
      ref={scroller}
      className={cn(
        // Negative margin + padding lets the scroll area bleed to the edge
        // on mobile while the content column keeps its gutter.
        'relative -mx-4 overflow-x-auto border-b border-line px-4 md:-mx-8 md:px-8',
        className,
      )}
    >
      <nav className="flex min-w-max gap-1" aria-label="Project sections">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 type-ui whitespace-nowrap transition-colors duration-100',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none',
                isActive
                  ? 'border-accent font-medium text-fg'
                  : 'border-transparent text-fg-muted hover:border-line-strong hover:text-fg',
              )
            }
          >
            {item.icon && <item.icon className="size-3.5 shrink-0" />}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
