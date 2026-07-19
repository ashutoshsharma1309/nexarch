import { Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import type { GenerationStatus } from '@/shared/types/api';

/**
 * Legend for run statuses, in pipeline order. Rendered now so the page
 * teaches the model before the first run exists; reused as the real
 * timeline's legend once Phase 2 populates this screen.
 */
const statusLegend: { status: GenerationStatus; meaning: string }[] = [
  { status: 'PENDING', meaning: 'Queued, waiting for a pipeline slot' },
  { status: 'ANALYZING', meaning: 'Extracting requirements from the prompt' },
  { status: 'PLANNING', meaning: 'Designing architecture and schema' },
  { status: 'GENERATING', meaning: 'Producing backend and frontend code' },
  { status: 'REVIEWING', meaning: 'Injecting security, optimizing output' },
  { status: 'COMPLETED', meaning: 'Ready to download or deploy' },
  { status: 'FAILED', meaning: 'Stopped with an error — resumable from the failed stage' },
];

const statusVariant: Record<GenerationStatus, 'neutral' | 'ember' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  ANALYZING: 'ember',
  PLANNING: 'ember',
  GENERATING: 'ember',
  REVIEWING: 'ember',
  COMPLETED: 'success',
  FAILED: 'danger',
};

export function GenerationsPage() {
  useDocumentTitle('Generations');
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        eyebrow="console/generations"
        title="Generations"
        description="Every pipeline run, across all projects."
      />

      <EmptyState
        icon={<Layers className="size-4" />}
        title="No generation runs yet"
        description="Runs are recorded here from the moment a forge starts, stage by stage."
        action={
          <Button
            variant="forge"
            onClick={() => {
              void navigate('/forge');
            }}
          >
            Start the first run
          </Button>
        }
      />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-fg">Run statuses</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {statusLegend.map(({ status, meaning }) => (
            <li key={status} className="flex items-center gap-4 px-4 py-2.5">
              <span className="w-28 shrink-0">
                <Badge variant={statusVariant[status]}>{status}</Badge>
              </span>
              <p className="text-xs text-fg-muted">{meaning}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
