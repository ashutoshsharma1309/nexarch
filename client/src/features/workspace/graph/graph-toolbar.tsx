/**
 * The toolbar: search, view mode, layout, reset.
 *
 * Zoom, fit and pan are React Flow's own Controls in the canvas corner —
 * duplicating them up here would be two places to look for the same thing.
 * What lives here is what changes *which graph* is drawn, not how it is
 * viewed.
 */
import { RotateCcw, Search } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { cn } from '@/shared/lib/cn';
import { LAYOUTS } from './layouts';
import type { LayoutId } from './layouts';
import { VIEW_MODES } from './view-modes';
import type { ViewModeId } from './view-modes';

export interface GraphToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  mode: ViewModeId;
  onMode: (mode: ViewModeId) => void;
  layout: LayoutId;
  onLayout: (layout: LayoutId) => void;
  onReset: () => void;
  visibleCount: number;
  totalCount: number;
}

export function GraphToolbar({
  search,
  onSearch,
  mode,
  onMode,
  layout,
  onLayout,
  onReset,
  visibleCount,
  totalCount,
}: GraphToolbarProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={search}
            onChange={(event) => {
              onSearch(event.target.value);
            }}
            placeholder="Search nodes"
            aria-label="Search graph nodes"
            className="pl-8"
          />
        </div>

        <label className="sr-only" htmlFor="graph-layout">
          Layout
        </label>
        <select
          id="graph-layout"
          value={layout}
          onChange={(event) => {
            onLayout(event.target.value as LayoutId);
          }}
          className="h-8 rounded-md border border-line bg-inset px-2 text-xs text-fg-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {LAYOUTS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>

        <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
          Reset
        </Button>

        <p className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle tabular-nums">
          {visibleCount}/{totalCount} nodes
        </p>
      </div>

      <div
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5"
        role="tablist"
        aria-label="Graph view"
      >
        {VIEW_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            title={item.description}
            onClick={() => {
              onMode(item.id);
            }}
            className={cn(
              'shrink-0 rounded-md border px-2 py-0.5 text-2xs whitespace-nowrap transition-colors',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
              mode === item.id
                ? 'border-ember text-fg'
                : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
