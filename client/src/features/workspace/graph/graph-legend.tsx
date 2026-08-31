/**
 * What the colours mean.
 *
 * Six families, not thirteen types — the node itself carries its exact
 * type in mono, so the legend only has to explain the colour. Sits inline
 * under the canvas rather than floating over it, because a panel that
 * overlaps the graph is a panel in the way.
 */
import { cn } from '@/shared/lib/cn';
import { FAMILY_DOT, FAMILY_LABEL, FAMILY_ORDER } from './node-style';

export function GraphLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}
      aria-label="Legend"
    >
      {FAMILY_ORDER.map((family) => (
        <li key={family} className="flex items-center gap-1.5 text-2xs text-fg-subtle">
          <span className={cn('size-2 rounded-full', FAMILY_DOT[family])} aria-hidden="true" />
          {FAMILY_LABEL[family]}
        </li>
      ))}
    </ul>
  );
}
