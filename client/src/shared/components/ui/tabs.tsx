import { NavLink } from 'react-router-dom';
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
 * Workspace tab bar.
 *
 * Tabs are links, not buttons: each section of a project is a real URL, so
 * it can be bookmarked, opened in a new tab, and reached by the back
 * button. `NavLink`'s own `aria-current="page"` is what marks the active
 * one — no parallel selected-state to keep in sync.
 *
 * On narrow screens the row scrolls horizontally rather than wrapping or
 * collapsing into a menu: eight destinations stay visible and swipeable,
 * and the active one is scrolled into view by the browser on navigation.
 */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <div
      className={cn(
        // Negative margin + padding lets the scroll area bleed to the edge
        // on mobile while the content column keeps its gutter.
        '-mx-4 overflow-x-auto border-b border-line px-4 md:-mx-8 md:px-8',
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
                'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[0.8125rem] whitespace-nowrap transition-colors duration-100',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none',
                isActive
                  ? 'border-ember font-medium text-fg'
                  : 'border-transparent text-fg-muted hover:border-line hover:text-fg',
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
