/**
 * The landing screen: what NexArch does, the state of this workspace, and the
 * one thing to do next.
 *
 * Every figure here comes from the project list. The Home used to report
 * "13/15 modules online", a number about NexArch's own internals that no user
 * has a use for.
 */
import { ArrowRight, FolderGit2, Hammer, PlayCircle, Plus, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { OnboardingWelcome } from '@/features/home/onboarding-welcome';
import { WorkspaceDrawing } from '@/features/home/workspace-drawing';
import { ProjectFormDialog } from '@/features/projects/components/project-form-dialog';
import type { ProjectFormValues } from '@/features/projects/components/project-form-dialog';
import { PROJECT_STATUS } from '@/features/projects/components/project-status';
import { useSettingsStore } from '@/features/settings/settings-store';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { StatusDot } from '@/shared/components/ui/status-dot';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useProjects } from '@/shared/hooks/use-projects';
import { useImportProject, useRunDemo } from '@/shared/hooks/use-portability';
import { useCreateProject, useUpdateProject } from '@/shared/hooks/use-workspace';
import { readJsonFile } from '@/shared/lib/download';
import { formatRelativeTime } from '@/shared/lib/format';
import { isDemoProject } from '@/shared/lib/prompt-examples';
import { useAuthStore } from '@/shared/store/auth.store';
import { toast } from '@/shared/store/toast.store';

export function HomePage() {
  useDocumentTitle('Home');
  const navigate = useNavigate();
  const projects = useProjects();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const importProject = useImportProject();
  const runDemo = useRunDemo();
  const user = useAuthStore((state) => state.user);
  const favoriteNewProjects = useSettingsStore((state) => state.favoriteNewProjects);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // A new project goes straight to its Build section: an empty project is not
  // a destination, it is a step on the way to describing what to build.
  const onCreate = (values: ProjectFormValues): void => {
    createProject.mutate(values, {
      onSuccess: (project) => {
        setCreateOpen(false);
        toast(`Created "${project.name}"`, 'success');
        if (favoriteNewProjects) {
          updateProject.mutate({ id: project.id, input: { favorite: true } });
        }
        void navigate(`/projects/${project.id}/build`);
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : 'Could not create the project', 'error');
      },
    });
  };

  const handleDemo = (): void => {
    runDemo.mutate(undefined, {
      onSuccess: (result) => {
        toast('Demo project ready', 'success');
        void navigate(`/projects/${result.project.id}`);
      },
      onError: () => {
        toast('Could not start the demo', 'error');
      },
    });
  };

  const handleImportFile = (file: File): void => {
    void readJsonFile(file)
      .then((pkg) => {
        importProject.mutate(pkg, {
          onSuccess: (result) => {
            toast(`Imported "${result.project.name}"`, 'success');
            void navigate(`/projects/${result.project.id}`);
          },
          onError: (error) => {
            toast(error instanceof Error ? error.message : 'Could not import the package', 'error');
          },
        });
      })
      .catch((error: unknown) => {
        toast(error instanceof Error ? error.message : 'Could not read that file', 'error');
      });
  };

  const all = projects.data ?? [];
  const recent = all.slice(0, 6);
  const lastChange = all.reduce<string | null>(
    (latest, project) =>
      latest === null || project.updatedAt > latest ? project.updatedAt : latest,
    null,
  );
  const known = projects.isSuccess;
  const showOnboarding = user !== null && user.onboardedAt === null;
  const openCreate = (): void => {
    setCreateOpen(true);
  };

  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleImportFile(file);
          event.target.value = '';
        }}
      />

      <section className="relative pt-4 pb-4 md:pt-8 md:pb-6">
        <div
          aria-hidden="true"
          // Fades on every side so the sheet has no edge to line up with the
          // content column on wide windows.
          className="pointer-events-none absolute -inset-x-4 -inset-y-2 sheet-grid [mask-image:radial-gradient(ellipse_75%_90%_at_72%_50%,black_25%,transparent_100%)] md:-inset-x-8"
        />
        <div className="relative grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:items-end md:gap-12">
          <div>
            <h1 className="max-w-[16ch] text-display text-balance text-fg">
              Describe an application. Inspect how it was built.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-fg-muted">
              NexArch plans the architecture, generates the code and database, reviews security, and
              runs the result on localhost. Every stage stays open for you to read.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <Button
                variant="forge"
                size="lg"
                icon={<Plus className="size-4" />}
                onClick={openCreate}
              >
                New project
              </Button>
              <Button
                size="lg"
                icon={<PlayCircle className="size-4" />}
                loading={runDemo.isPending}
                onClick={handleDemo}
              >
                Try the demo
              </Button>
              <Button
                variant="ghost"
                size="lg"
                icon={<Upload className="size-4" />}
                loading={importProject.isPending}
                onClick={() => {
                  importInputRef.current?.click();
                }}
              >
                Import
              </Button>
            </div>
          </div>
          <div className="hidden sm:block">
            <WorkspaceDrawing
              total={known ? all.length : null}
              active={known ? all.filter((p) => p.status === 'ACTIVE').length : null}
              lastChange={lastChange ? formatRelativeTime(lastChange) : null}
            />
          </div>
        </div>
      </section>

      {showOnboarding && (
        <div className="mt-8">
          <OnboardingWelcome
            onCreate={openCreate}
            onDemo={handleDemo}
            demoLoading={runDemo.isPending}
          />
        </div>
      )}

      <section className="mt-8" aria-label="Recent projects">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold tracking-tight text-fg">Recent projects</h2>
          {recent.length > 0 && (
            <Link
              to="/projects"
              className="flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg"
            >
              All projects
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>

        {projects.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : projects.isError ? (
          <EmptyState
            icon={<RefreshCw className="size-4" />}
            title="Your projects could not be loaded"
            description={projects.error.message}
            action={
              <Button
                onClick={() => {
                  void projects.refetch();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="size-4" />}
            title="No projects yet"
            description="A project holds one application: its requirements, architecture, code, review and preview."
            action={
              <Button variant="forge" icon={<Hammer className="size-3.5" />} onClick={openCreate}>
                Create your first project
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {recent.map((project) => {
              const status = PROJECT_STATUS[project.status];
              return (
                <li key={project.id}>
                  <Link
                    to={`/projects/${project.id}`}
                    className="group flex items-center gap-4 px-1 py-3 transition-colors hover:bg-raised/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{project.name}</p>
                      <p className="mt-0.5 truncate text-xs text-fg-subtle">
                        <span className="font-mono">{project.slug}</span>
                      </p>
                    </div>
                    {isDemoProject(project.name) && <Badge>Demo</Badge>}
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                      <StatusDot tone={status.tone} />
                      {status.label}
                    </span>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-fg-subtle tabular-nums sm:block">
                      {formatRelativeTime(project.updatedAt)}
                    </span>
                    <ArrowRight
                      className="size-3.5 shrink-0 text-fg-subtle transition-colors group-hover:text-fg"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ProjectFormDialog
        open={createOpen}
        mode="create"
        loading={createProject.isPending}
        onSubmit={onCreate}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
    </>
  );
}
