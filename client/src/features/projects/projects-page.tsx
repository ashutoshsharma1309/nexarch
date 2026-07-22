import { FolderGit2, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/components/ui/button';
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useProjects } from '@/shared/hooks/use-projects';
import {
  useCreateProject,
  useDeleteProject,
  useDuplicateProject,
  useUpdateProject,
} from '@/shared/hooks/use-workspace';
import { toast } from '@/shared/store/toast.store';
import type { Project } from '@/shared/types/api';
import { ProjectCard } from './components/project-card';
import { ProjectFormDialog } from './components/project-form-dialog';
import type { ProjectFormValues } from './components/project-form-dialog';
import { useSettingsStore } from '../settings/settings-store';

export function ProjectsPage() {
  useDocumentTitle('Projects');
  const navigate = useNavigate();
  const projects = useProjects();
  const [query, setQuery] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const duplicateProject = useDuplicateProject();
  const favoriteNewProjects = useSettingsStore((state) => state.favoriteNewProjects);

  const filtered = (projects.data ?? []).filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const handleCreate = (values: ProjectFormValues): void => {
    createProject.mutate(
      { name: values.name, description: values.description || undefined },
      {
        onSuccess: (project) => {
          setCreateOpen(false);
          toast(`Created "${project.name}"`, 'success');
          if (favoriteNewProjects) {
            updateProject.mutate({ id: project.id, input: { favorite: true } });
          }
          void navigate(`/projects/${project.id}`);
        },
        onError: () => {
          toast('Could not create the project', 'error');
        },
      },
    );
  };

  const handleRename = (values: ProjectFormValues): void => {
    if (!renaming) return;
    updateProject.mutate(
      { id: renaming.id, input: { name: values.name, description: values.description } },
      {
        onSuccess: () => {
          setRenaming(null);
          toast('Project renamed', 'success');
        },
        onError: () => {
          toast('Could not rename the project', 'error');
        },
      },
    );
  };

  const handleToggleArchive = (project: Project): void => {
    updateProject.mutate(
      { id: project.id, input: { status: project.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED' } },
      {
        onSuccess: () => {
          toast(
            project.status === 'ARCHIVED' ? 'Project unarchived' : 'Project archived',
            'success',
          );
        },
      },
    );
  };

  const handleToggleFavorite = (project: Project): void => {
    updateProject.mutate({ id: project.id, input: { favorite: !project.favorite } });
  };

  const handleDuplicate = (project: Project): void => {
    duplicateProject.mutate(project.id, {
      onSuccess: (copy) => {
        toast(`Duplicated as "${copy.name}"`, 'success');
      },
      onError: () => {
        toast('Could not duplicate the project', 'error');
      },
    });
  };

  const handleDelete = (): void => {
    if (!deleting) return;
    deleteProject.mutate(deleting.id, {
      onSuccess: () => {
        toast(`Deleted "${deleting.name}"`, 'success');
        setDeleting(null);
      },
      onError: () => {
        toast('Could not delete the project', 'error');
      },
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="console/projects"
        title="Projects"
        description="Every application this workspace has forged."
        actions={
          <Button
            variant="forge"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            New project
          </Button>
        }
      />

      <div className="relative mb-4 max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
        <Input
          type="search"
          placeholder="Search projects"
          aria-label="Search projects"
          className="pl-8"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>

      {projects.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-36 w-full" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onRename={setRenaming}
              onDuplicate={handleDuplicate}
              onToggleArchive={handleToggleArchive}
              onToggleFavorite={handleToggleFavorite}
              onDelete={setDeleting}
            />
          ))}
        </div>
      ) : query !== '' ? (
        <EmptyState
          icon={<Search className="size-4" />}
          title={`No projects match "${query}"`}
          description="Check the spelling or clear the search to see everything."
          action={
            <Button
              onClick={() => {
                setQuery('');
              }}
            >
              Clear search
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<FolderGit2 className="size-4" />}
          title="No projects yet"
          description="Create a project to track its documentation, exports, and generation history."
          action={
            <Button
              variant="forge"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              New project
            </Button>
          }
        />
      )}

      <ProjectFormDialog
        open={createOpen}
        mode="create"
        loading={createProject.isPending}
        onSubmit={handleCreate}
        onClose={() => {
          setCreateOpen(false);
        }}
      />

      <ProjectFormDialog
        open={renaming !== null}
        mode="rename"
        initialValues={
          renaming ? { name: renaming.name, description: renaming.description ?? '' } : undefined
        }
        loading={updateProject.isPending}
        onSubmit={handleRename}
        onClose={() => {
          setRenaming(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete project"
        description={`"${deleting?.name}" and its generation history will be permanently removed. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleteProject.isPending}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(null);
        }}
      />
    </>
  );
}
