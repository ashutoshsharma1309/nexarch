import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** Mono eyebrow above the title, e.g. "console/projects". */
  eyebrow: string;
  title: string;
  description?: string;
  /** Right-aligned actions. */
  actions?: ReactNode;
}

/**
 * Every page opens with the same header anatomy. The eyebrow is set in
 * mono as a path — the interface talks to developers in their notation.
 */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
          {eyebrow}
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-xl text-[0.8125rem] text-fg-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
