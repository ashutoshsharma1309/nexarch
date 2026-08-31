import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Omit for the current page — the last crumb is never a link. */
  to?: string;
}

/**
 * Trail from the root to the current page.
 *
 * Rendered as an ordered list inside a labelled `nav`, with the current
 * page carrying `aria-current="page"` — the structure screen readers
 * expect. Separators are `aria-hidden` because a chevron is decoration,
 * not content.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 font-mono text-2xs tracking-wide text-fg-subtle">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.to && !last ? (
                <Link
                  to={item.to}
                  className="rounded-sm transition-colors hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={last ? 'text-fg-muted' : undefined}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3 shrink-0 opacity-50" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
