import { KeyRound, Link2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/cn';
import type { ColumnDesign, TableDesign } from '@/shared/types/api';

function ColumnRow({ column }: { column: ColumnDesign }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-3 align-top">
        <div className="flex items-center gap-1.5">
          {column.primaryKey && (
            <KeyRound className="size-3 shrink-0 text-warning" aria-label="Primary key" />
          )}
          {column.references && (
            <Link2 className="size-3 shrink-0 text-accent" aria-label="Foreign key" />
          )}
          <code className="font-mono text-xs text-fg">{column.name}</code>
        </div>
      </td>
      <td className="py-2 pr-3 align-top">
        <code className="font-mono text-2xs text-fg-muted">{column.sqlType}</code>
      </td>
      <td className="py-2 pr-3 align-top">
        <div className="flex flex-wrap gap-1">
          {!column.nullable && <Badge variant="neutral">NOT NULL</Badge>}
          {column.unique && !column.primaryKey && <Badge variant="accent">UNIQUE</Badge>}
          {column.references && <Badge variant="neutral">→ {column.references.table}</Badge>}
          {column.enumValues && <Badge variant="ember">enum</Badge>}
        </div>
      </td>
    </tr>
  );
}

export function EntityDetail({ table }: { table: TableDesign }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-fg">{table.entity}</h2>
          <code className="font-mono text-2xs text-fg-subtle">{table.tableName}</code>
        </div>
        <div className="flex gap-1.5">
          <Badge variant="neutral">{table.columns.length} columns</Badge>
          {table.softDelete && <Badge variant="accent">soft delete</Badge>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface px-4 py-2">
        <table className="w-full min-w-[32rem] text-left">
          <thead>
            <tr className="border-b border-line font-mono text-2xs tracking-wide text-fg-subtle uppercase">
              <th className="py-2 pr-3 font-medium">Column</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Constraints</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((column) => (
              <ColumnRow key={column.name} column={column} />
            ))}
          </tbody>
        </table>
      </div>

      {table.indexes.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
            Indexes
          </p>
          <ul className="space-y-1">
            {table.indexes.map((index) => (
              <li key={index.name} className={cn('flex flex-wrap items-baseline gap-2 text-xs')}>
                <code className="font-mono text-2xs text-fg">
                  {index.unique ? 'UNIQUE ' : ''}({index.columns.join(', ')})
                </code>
                <span className="text-fg-muted">{index.rationale}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
