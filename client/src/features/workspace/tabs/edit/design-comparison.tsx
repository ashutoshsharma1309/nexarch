/**
 * The project's design before the edit, beside the design the edit proposed.
 *
 * This is a comparison of two sets of design decisions — theme mode, accent,
 * typeface, section order — and nothing more. It deliberately carries no
 * score: "87% similar to your reference" is a number nobody can check and
 * nobody asked for, and the four rows below are the facts it would have been
 * derived from anyway.
 *
 * The "before" side comes from the baseline run's artifacts. When the server
 * no longer holds them there is no before, and the panel says so rather than
 * comparing the proposal against a blank.
 */
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';
import type { SiteDesignView } from '@/shared/types/api';

function Swatch({ colour }: { colour: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-3.5 rounded border border-line"
        style={{ backgroundColor: colour }}
        aria-hidden="true"
      />
      <span className="font-mono text-2xs text-fg-muted">{colour}</span>
    </span>
  );
}

function Row({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: ReactNode;
  after: ReactNode;
  changed: boolean;
}) {
  return (
    <div
      className="grid grid-cols-[6rem_1fr_1fr] items-start gap-3 px-3 py-2"
      data-changed={changed}
    >
      <p className="font-mono text-2xs text-fg-subtle">{label}</p>
      <div className="text-xs text-fg-muted">{before}</div>
      <div className={cn('text-xs', changed ? 'font-medium text-fg' : 'text-fg-muted')}>
        {after}
      </div>
    </div>
  );
}

export function DesignComparison({
  before,
  after,
  unavailableReason,
}: {
  before: SiteDesignView | null;
  after: SiteDesignView;
  /** Why there is no "before", when there is none. */
  unavailableReason: string;
}) {
  if (!before) {
    return (
      <div className="rounded-md border border-line px-3 py-2.5">
        <p className="text-xs text-fg-muted">{unavailableReason}</p>
        <p className="mt-2 font-mono text-2xs text-fg-subtle">
          proposed · {after.theme.mode} · {after.theme.fontId} ·{' '}
          {after.sections.map((section) => section.kind).join(' › ')}
        </p>
      </div>
    );
  }

  const beforeKinds = before.sections.map((section) => section.kind);
  const afterKinds = after.sections.map((section) => section.kind);

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="grid grid-cols-[6rem_1fr_1fr] gap-3 border-b border-line bg-raised/40 px-3 py-1.5">
        <span className="font-mono text-2xs text-fg-subtle">decision</span>
        <span className="font-mono text-2xs text-fg-subtle">before</span>
        <span className="flex items-center gap-1 font-mono text-2xs text-fg-subtle">
          <ArrowRight className="size-3" /> after
        </span>
      </div>
      <div className="divide-y divide-line">
        <Row
          label="theme"
          before={before.theme.mode}
          after={after.theme.mode}
          changed={before.theme.mode !== after.theme.mode}
        />
        <Row
          label="accent"
          before={<Swatch colour={before.theme.palette.accent} />}
          after={<Swatch colour={after.theme.palette.accent} />}
          changed={before.theme.palette.accent !== after.theme.palette.accent}
        />
        <Row
          label="typeface"
          before={before.theme.fontId}
          after={after.theme.fontId}
          changed={before.theme.fontId !== after.theme.fontId}
        />
        <Row
          label="sections"
          before={beforeKinds.join(' › ')}
          after={afterKinds.join(' › ')}
          changed={beforeKinds.join() !== afterKinds.join()}
        />
      </div>
    </div>
  );
}
