import { useState } from 'react';
import { ArrowLeft, FileText, Layers, PackageOpen, Star } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog';
import { Dialog } from '@/shared/components/ui/dialog';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import {
  useDeleteProject,
  useDuplicateProject,
  useProjectDashboard,
  useRecordGeneration,
  useUpdateProject,
} from '@/shared/hooks/use-workspace';
import { formatDate, formatRelativeTime } from '@/shared/lib/format';
import { toast } from '@/shared/store/toast.store';
import type { GenerationStatus, ProjectStatus } from '@/shared/types/api';
import { ProjectFormDialog } from './components/project-form-dialog';
import type { ProjectFormValues } from './components/project-form-dialog';

const statusVariant: Record<ProjectStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

const generationVariant: Record<GenerationStatus, 'neutral' | 'ember' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  ANALYZING: 'ember',
  PLANNING: 'ember',
  GENERATING: 'ember',
  REVIEWING: 'ember',
  COMPLETED: 'success',
  FAILED: 'danger',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</p>
        <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function LogGenerationDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const recordGeneration = useRecordGeneration();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log a generation run"
      description="Record a pipeline run against this project for the history timeline."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim() === '') return;
          recordGeneration.mutate(
            { projectId, input: { prompt: prompt.trim(), status: 'COMPLETED' } },
            {
              onSuccess: () => {
                setPrompt('');
                onClose();
                toast('Generation run logged', 'success');
              },
              onError: () => {
                toast('Could not log the generation run', 'error');
              },
            },
          );
        }}
        className="space-y-3"
      >
        <div>
          <Label htmlFor="generation-prompt">Prompt</Label>
          <Input
            id="generation-prompt"
            autoFocus
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            placeholder="What did this run generate?"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={recordGeneration.isPending}
            disabled={prompt.trim() === ''}
          >
            Log run
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dashboard = useProjectDashboard(id);
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const duplicateProject = useDuplicateProject();

  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [logging, setLogging] = useState(false);

  useDocumentTitle(dashboard.data?.project.name ?? 'Project');

  if (!id) return null;

  const handleRename = (values: ProjectFormValues): void => {
    updateProject.mutate(
      { id, input: { name: values.name, description: values.description } },
      {
        onSuccess: () => {
          setRenaming(false);
          toast('Project renamed', 'success');
        },
      },
    );
  };

  const handleDelete = (): void => {
    deleteProject.mutate(id, {
      onSuccess: () => {
        toast('Project deleted', 'success');
        void navigate('/projects');
      },
    });
  };

  const handleDuplicate = (): void => {
    duplicateProject.mutate(id, {
      onSuccess: (copy) => {
        toast(`Duplicated as "${copy.name}"`, 'success');
        void navigate(`/projects/${copy.id}`);
      },
    });
  };

  const handleToggleFavorite = (): void => {
    if (!dashboard.data) return;
    updateProject.mutate({ id, input: { favorite: !dashboard.data.project.favorite } });
  };

  const handleToggleArchive = (): void => {
    if (!dashboard.data) return;
    const nextStatus = dashboard.data.project.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
    updateProject.mutate({ id, input: { status: nextStatus } });
  };

  return (
    <>
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" />
        Projects
      </Link>

      {dashboard.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </div>
      )}

      {dashboard.isError && (
        <EmptyState title="Project not found" description="It may have been deleted." />
      )}

      {dashboard.data && (
        <>
          <PageHeader
            eyebrow={`console/projects/${dashboard.data.project.slug}`}
            title={dashboard.data.project.name}
            description={dashboard.data.project.description ?? undefined}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToggleFavorite}
                  aria-label={dashboard.data.project.favorite ? 'Unfavorite' : 'Favorite'}
                >
                  <Star
                    className={
                      dashboard.data.project.favorite ? 'size-4 fill-current text-ember' : 'size-4'
                    }
                  />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRenaming(true);
                  }}
                >
                  Rename
                </Button>
                <Button variant="secondary" size="sm" onClick={handleDuplicate}>
                  Duplicate
                </Button>
                <Button variant="secondary" size="sm" onClick={handleToggleArchive}>
                  {dashboard.data.project.status === 'ARCHIVED' ? 'Unarchive' : 'Archive'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDeleting(true);
                  }}
                >
                  Delete
                </Button>
              </>
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant[dashboard.data.project.status]}>
              {dashboard.data.project.status}
            </Badge>
            <span className="text-2xs text-fg-subtle">
              Created {formatDate(dashboard.data.project.createdAt)} · Updated{' '}
              {formatDate(dashboard.data.project.updatedAt)}
            </span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Generation runs" value={String(dashboard.data.stats.totalGenerations)} />
            <Stat label="Completed" value={String(dashboard.data.stats.completedGenerations)} />
            <Stat label="Failed" value={String(dashboard.data.stats.failedGenerations)} />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Link
              to="/documentation"
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
            >
              <FileText className="size-4" />
              Generate documentation
            </Link>
            <Link
              to="/exports"
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
            >
              <PackageOpen className="size-4" />
              Export this project
            </Link>
            <button
              type="button"
              onClick={() => {
                setLogging(true);
              }}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-left text-xs text-fg-muted hover:border-line-strong hover:text-fg"
            >
              <Layers className="size-4" />
              Log a generation run
            </button>
          </div>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-fg">Generation history</h2>
            {dashboard.data.generations.length === 0 ? (
              <EmptyState
                icon={<Layers className="size-4" />}
                title="No runs logged yet"
                description="Log a generation run to start building this project's history."
              />
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {dashboard.data.generations.map((generation) => (
                    <li key={generation.id} className="flex items-center gap-4 px-5 py-3">
                      <Badge variant={generationVariant[generation.status]}>
                        {generation.status}
                      </Badge>
                      <p className="min-w-0 flex-1 truncate text-xs text-fg">{generation.prompt}</p>
                      <span className="shrink-0 font-mono text-2xs text-fg-subtle">
                        {formatRelativeTime(generation.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-fg">Activity</h2>
            {dashboard.data.activity.length === 0 ? (
              <EmptyState title="No activity yet" description="Project events appear here." />
            ) : (
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="sr-only">Activity</CardTitle>
                </CardHeader>
                <ul className="divide-y divide-line">
                  {dashboard.data.activity.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-4 px-5 py-2.5">
                      <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                        {entry.message}
                      </p>
                      <span className="shrink-0 font-mono text-2xs text-fg-subtle">
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <ProjectFormDialog
            open={renaming}
            mode="rename"
            initialValues={{
              name: dashboard.data.project.name,
              description: dashboard.data.project.description ?? '',
            }}
            loading={updateProject.isPending}
            onSubmit={handleRename}
            onClose={() => {
              setRenaming(false);
            }}
          />

          <ConfirmDialog
            open={deleting}
            title="Delete project"
            description={`"${dashboard.data.project.name}" and its generation history will be permanently removed. This can't be undone.`}
            confirmLabel="Delete"
            destructive
            loading={deleteProject.isPending}
            onConfirm={handleDelete}
            onCancel={() => {
              setDeleting(false);
            }}
          />

          <LogGenerationDialog
            open={logging}
            projectId={id}
            onClose={() => {
              setLogging(false);
            }}
          />
        </>
      )}
    </>
  );
}
