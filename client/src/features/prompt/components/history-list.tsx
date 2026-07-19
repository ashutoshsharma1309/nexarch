import { History, Trash2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { formatDate } from '@/shared/lib/format';
import { useForgeStore } from '../forge-store';

export interface HistoryListProps {
  /** Load a previous prompt back into the editor. */
  onSelect: (prompt: string) => void;
}

export function HistoryList({ onSelect }: HistoryListProps) {
  const history = useForgeStore((state) => state.history);
  const clearHistory = useForgeStore((state) => state.clearHistory);

  if (history.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-fg">
          <History className="size-4 text-fg-subtle" />
          Recent prompts
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={clearHistory}
        >
          Clear
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {history.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(entry.prompt);
              }}
              className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors hover:bg-raised/60"
            >
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] text-fg">{entry.prompt}</span>
                <span className="mt-0.5 block text-2xs text-fg-subtle">
                  {entry.projectType ?? 'Unclassified'} · {formatDate(entry.analyzedAt)}
                </span>
              </span>
              <Badge variant={entry.status === 'COMPLETE' ? 'success' : 'accent'}>
                {entry.status}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
