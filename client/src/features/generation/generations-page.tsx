import { Layers } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useProjects } from '@/shared/hooks/use-projects';
import { useWorkspaceHistory } from '@/shared/hooks/use-workspace';
import { formatRelativeTime } from '@/shared/lib/format';
import type { GenerationStatus } from '@/shared/types/api';

/** Legend for run statuses, in pipeline order. */
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
  const history = useWorkspaceHistory({ limit: 100 });
  const projects = useProjects();

  const projectNameById = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const generations = history.data?.generations ?? [];

  return (
    <>
      <PageHeader
        eyebrow="console/generations"
        title="Generations"
        description="Every pipeline run, across all projects."
      />

      {history.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : generations.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-4" />}
          title="No generation runs yet"
          description="Runs are recorded here once a project logs its first run."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('/projects');
              }}
            >
              Open projects
            </Button>
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {generations.map((generation) => (
              <li key={generation.id} className="flex items-center gap-4 px-5 py-3">
                <Badge variant={statusVariant[generation.status]}>{generation.status}</Badge>
                <Link
                  to={`/projects/${generation.projectId}`}
                  className="w-40 shrink-0 truncate text-xs font-medium text-fg hover:text-accent"
                >
                  {projectNameById.get(generation.projectId) ?? 'Unknown project'}
                </Link>
                <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">{generation.prompt}</p>
                {generation.model && (
                  <span className="hidden shrink-0 font-mono text-2xs text-fg-subtle sm:inline">
                    {generation.model}
                  </span>
                )}
                <span className="shrink-0 font-mono text-2xs text-fg-subtle">
                  {formatRelativeTime(generation.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
