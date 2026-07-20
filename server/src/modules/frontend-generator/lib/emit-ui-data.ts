/**
 * Emits data-display components: a generic DataTable, Pagination,
 * SearchInput (debounced), StatCard, Breadcrumbs, and a dependency-free
 * inline-SVG sparkline ChartCard — no charting library needed for a trend
 * line, which keeps the generated bundle lean.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const dataTable = `import type { ReactNode } from 'react';

import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
}

/** Generic, memo-friendly table: pass a stable \`columns\` array (defined
 * outside render or via useMemo) to avoid re-rendering every cell on parent
 * re-renders that don't change the data. Unconstrained over T — the entity
 * records this renders are plain interfaces with no index signature, and
 * constraining T to Record<string, unknown> would reject every one of them
 * at the call site. */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  loading = false,
  emptyTitle = 'No records yet',
  emptyDescription,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[36rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line font-mono text-2xs uppercase tracking-wide text-fg-subtle">
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-2.5 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((row) => (
            <tr
              key={getRowId(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer hover:bg-raised/50' : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={\`px-4 py-2.5 text-fg \${column.className ?? ''}\`}>
                  {column.render
                    ? column.render(row)
                    : String((row as Record<string, unknown>)[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
`;

const pagination = `import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, hasNext, hasPrev, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between px-1 py-2">
      <p className="font-mono text-2xs text-fg-subtle">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasPrev}
          onClick={() => {
            onPageChange(page - 1);
          }}
          aria-label="Previous page"
          icon={<ChevronLeft className="size-3.5" />}
        >
          Prev
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasNext}
          onClick={() => {
            onPageChange(page + 1);
          }}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </nav>
  );
}
`;

const useDebouncedValue = `import { useEffect, useState } from 'react';

/** Delays reflecting \`value\` until it stops changing for \`delayMs\`. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
`;

const searchInput = `import { Search } from 'lucide-react';
import { useState } from 'react';

import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { useEffectOnUpdate } from '@/shared/hooks/use-effect-on-update';
import { Input } from './input';

export interface SearchInputProps {
  placeholder?: string;
  onSearch: (value: string) => void;
}

export function SearchInput({ placeholder = 'Search…', onSearch }: SearchInputProps) {
  const [value, setValue] = useState('');
  const debounced = useDebouncedValue(value, 300);

  useEffectOnUpdate(() => {
    onSearch(debounced);
  }, [debounced]);

  return (
    <div className="relative max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
      <Input
        type="search"
        aria-label="Search"
        placeholder={placeholder}
        className="pl-8"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
    </div>
  );
}
`;

const useEffectOnUpdate = `import { useEffect, useRef } from 'react';

/** Like useEffect, but skips the mount run — only fires on updates. */
export function useEffectOnUpdate(effect: () => void, deps: unknown[]): void {
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
`;

const statCard = `import type { ReactNode } from 'react';

import { Card, CardContent } from './card';
import { Skeleton } from './skeleton';

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  loading?: boolean;
}

export function StatCard({ label, value, hint, icon, loading = false }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between py-4">
        <div>
          <p className="font-mono text-2xs uppercase tracking-widest text-fg-subtle">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
          )}
          {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
        </div>
        {icon && <div className="text-fg-subtle">{icon}</div>}
      </CardContent>
    </Card>
  );
}
`;

const chartCard = `import { Card, CardContent, CardHeader, CardTitle } from './card';

export interface ChartCardProps {
  title: string;
  points: number[];
}

/** Dependency-free inline-SVG sparkline — no charting library for a trend line. */
export function ChartCard({ title, points }: ChartCardProps) {
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const range = max - min || 1;
  const width = 240;
  const height = 56;
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return \`\${index === 0 ? 'M' : 'L'}\${x.toFixed(1)},\${y.toFixed(1)}\`;
    })
    .join(' ');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox={\`0 0 \${width} \${height}\`} className="h-14 w-full text-accent" role="img" aria-label={title + ' trend'}>
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </CardContent>
    </Card>
  );
}
`;

const breadcrumbs = `import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Breadcrumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-xs text-fg-muted">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="size-3 text-fg-subtle" aria-hidden="true" />}
            {item.to ? (
              <Link to={item.to} className="hover:text-fg">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-fg">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
`;

export function emitUiData(): GeneratedFile[] {
  return [
    file('src/shared/components/ui/data-table.tsx', 'typescriptreact', dataTable),
    file('src/shared/components/ui/pagination.tsx', 'typescriptreact', pagination),
    file('src/shared/components/ui/search-input.tsx', 'typescriptreact', searchInput),
    file('src/shared/components/ui/stat-card.tsx', 'typescriptreact', statCard),
    file('src/shared/components/ui/chart-card.tsx', 'typescriptreact', chartCard),
    file('src/shared/components/ui/breadcrumbs.tsx', 'typescriptreact', breadcrumbs),
    file('src/shared/hooks/use-debounced-value.ts', 'typescript', useDebouncedValue),
    file('src/shared/hooks/use-effect-on-update.ts', 'typescript', useEffectOnUpdate),
  ];
}
