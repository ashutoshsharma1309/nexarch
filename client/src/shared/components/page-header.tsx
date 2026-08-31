import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export interface PageHeaderProps {
  /** Mono eyebrow above the title, e.g. "console/projects". Omitted for sections. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Right-aligned actions. */
  actions?: ReactNode;
  /**
   * `page` opens a route. `section` opens a panel inside one that already
   * has a header — smaller type, tighter margin, no eyebrow, so a project
   * workspace tab does not appear to announce itself twice.
   */
  variant?: 'page' | 'section';
}

/**
 * Every page opens with the same header anatomy. The eyebrow is set in
 * mono as a path — the interface talks to developers in their notation.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  variant = 'page',
}: PageHeaderProps) {
  const section = variant === 'section';
  const Heading = section ? 'h2' : 'h1';

  return (
    <header
      className={cn('flex flex-wrap items-end justify-between gap-4', section ? 'mb-4' : 'mb-8')}
    >
      <div>
        {eyebrow && !section && (
          <p className="mb-1 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
            {eyebrow}
          </p>
        )}
        <Heading
          className={cn('font-semibold tracking-tight text-fg', section ? 'text-sm' : 'text-xl')}
        >
          {title}
        </Heading>
        {description && (
          <p
            className={cn(
              'max-w-xl text-fg-muted',
              section ? 'mt-1 text-xs' : 'mt-1.5 text-[0.8125rem]',
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
