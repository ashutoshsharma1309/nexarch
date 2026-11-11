import type { ReactNode } from 'react';

/** The heading of a top-level page: one title, one sentence, its actions. */
export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-title text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
