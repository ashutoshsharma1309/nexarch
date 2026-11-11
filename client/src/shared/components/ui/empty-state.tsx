import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Primary action — an empty screen is an invitation to act. */
  action?: ReactNode;
  className?: string;
}

/**
 * An empty region, drawn as a blank sheet: the drafting grid behind it, the
 * title, what would be here, and the one thing to do next.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'relative isolate flex flex-col items-center justify-center overflow-hidden rounded-lg border border-line px-6 py-16 text-center',
        className,
      )}
    >
      <div
        aria-hidden="true"
        // Clear behind the words, grid only towards the edges of the sheet.
        className="absolute inset-0 -z-10 sheet-grid [mask-image:radial-gradient(ellipse_at_center,transparent_35%,black_100%)]"
      />
      {icon && (
        <div className="mb-4 flex size-10 items-center justify-center rounded-md border border-line-strong/70 bg-surface text-fg-muted">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold tracking-tight text-fg">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md type-ui leading-relaxed text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
