import { Lock } from 'lucide-react';
import { useMemo } from 'react';

import { Card } from '@/shared/components/ui/card';
import { cn } from '@/shared/lib/cn';
import type { OpenApiDocument, OpenApiOperation } from '@/shared/types/api';

const METHOD_STYLES: Record<string, string> = {
  get: 'text-accent border-accent/30',
  post: 'text-success border-success/30',
  put: 'text-warning border-warning/30',
  patch: 'text-warning border-warning/30',
  delete: 'text-danger border-danger/30',
};

interface FlatOperation {
  method: string;
  path: string;
  operation: OpenApiOperation;
}

function operationsByTag(doc: OpenApiDocument): Map<string, FlatOperation[]> {
  const byTag = new Map<string, FlatOperation[]>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      const tag = operation.tags[0] ?? 'default';
      const list = byTag.get(tag) ?? [];
      list.push({ method, path, operation });
      byTag.set(tag, list);
    }
  }
  return byTag;
}

function OperationRow({ entry }: { entry: FlatOperation }) {
  const { method, path, operation } = entry;
  const responseCodes = Object.keys(operation.responses);
  return (
    <details className="group border-b border-line last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 hover:bg-raised/50">
        <span
          className={cn(
            'w-14 shrink-0 rounded-sm border text-center font-mono text-2xs font-medium uppercase',
            METHOD_STYLES[method],
          )}
        >
          {method}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{path}</code>
        {operation.security && (
          <Lock className="size-3 shrink-0 text-fg-subtle" aria-label="Requires auth" />
        )}
      </summary>
      <div className="space-y-2 px-3 pb-3 pl-[4.75rem] text-xs text-fg-muted">
        <p>{operation.summary}</p>
        {operation.parameters && operation.parameters.length > 0 && (
          <p className="font-mono text-2xs text-fg-subtle">
            params: {operation.parameters.map((p) => p.name).join(', ')}
          </p>
        )}
        <p className="flex flex-wrap gap-1 font-mono text-2xs">
          {responseCodes.map((code) => (
            <span key={code} className="rounded-sm border border-line px-1 text-fg-subtle">
              {code}
            </span>
          ))}
        </p>
      </div>
    </details>
  );
}

export function OpenApiExplorer({ doc }: { doc: OpenApiDocument }) {
  const grouped = useMemo(() => operationsByTag(doc), [doc]);

  return (
    <div className="space-y-4">
      {[...grouped.entries()].map(([tag, operations]) => (
        <Card key={tag} className="overflow-hidden">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
            <h3 className="text-[0.8125rem] font-medium text-fg">{tag}</h3>
            <span className="font-mono text-2xs text-fg-subtle">
              {operations.length} operations
            </span>
          </div>
          <div>
            {operations.map((entry) => (
              <OperationRow key={`${entry.method} ${entry.path}`} entry={entry} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
