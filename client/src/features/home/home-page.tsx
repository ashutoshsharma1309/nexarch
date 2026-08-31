/**
 * The landing screen: what you have, and the one thing you do next.
 *
 * It replaces a dashboard whose three tiles counted projects, counted
 * generations, and reported "13/15 modules online" — a number about
 * NexArch's own internals that no user of NexArch has a use for. What is
 * here instead is the work: start a project, or return to one.
 */
import { ArrowRight, FolderGit2, Hammer, Plus, Sparkles, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { OnboardingWelcome } from '@/features/home/onboarding-welcome';
import { ProjectFormDialog } from '@/features/projects/components/project-form-dialog';
import type { ProjectFormValues } from '@/features/projects/components/project-form-dialog';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Badge } from '@/shared/components/ui/badge';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useProjects } from '@/shared/hooks/use-projects';
import { useCreateProject } from '@/shared/hooks/use-workspace';
import { useImportProject, useRunDemo } from '@/shared/hooks/use-portability';
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
  const importProject = useImportProject();
  const runDemo = useRunDemo();
  const user = useAuthStore((state) => state.user);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // A new project goes straight to its Build tab: an empty project is not
  // a destination, it is a step on the way to describing what to build.
  const onCreate = (values: ProjectFormValues): void => {
    createProject.mutate(values, {
      onSuccess: (project) => {
        setCreateOpen(false);
        toast(`Created "${project.name}"`, 'success');
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

  const recent = (projects.data ?? []).slice(0, 6);
  const showOnboarding = user !== null && user.onboardedAt === null;

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

      <PageHeader
        eyebrow="console/home"
        title="NexArch"
        description="Describe an application. NexArch analyzes it, plans the architecture, generates the code, hardens it, and runs it on localhost."
        actions={
          <Button
            variant="forge"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            New project
          </Button>
        }
      />

      {showOnboarding && (
        <div className="mb-6">
          <OnboardingWelcome
            onCreate={() => {
              setCreateOpen(true);
            }}
            onDemo={handleDemo}
            demoLoading={runDemo.isPending}
          />
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ember-soft text-ember">
              <Hammer className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-fg">Start a new application</h2>
              <p className="mt-0.5 text-xs text-fg-muted">
                Name it, describe it, and watch every stage run — or open a ready-made demo.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              icon={<Sparkles className="size-3.5" />}
              loading={runDemo.isPending}
              onClick={handleDemo}
            >
              Try the demo
            </Button>
            <Button
              variant="secondary"
              icon={<Upload className="size-3.5" />}
              loading={importProject.isPending}
              onClick={() => {
                importInputRef.current?.click();
              }}
            >
              Import
            </Button>
            <Button
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              Create project
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg">Your projects</h2>
          {recent.length > 0 && (
            <Link
              to="/projects"
              className="flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg"
            >
              All projects
              <ArrowRight className="size-3" />
            </Link>
          )}
        </div>

        {projects.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="size-4" />}
            title="No projects yet"
            description="A project is one application: its requirements, architecture, code, security review and preview all live together."
            action={
              <Button
                variant="forge"
                icon={<Hammer className="size-3.5" />}
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                Create your first project
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {recent.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-medium text-fg">{project.name}</p>
                    <p className="mt-0.5 font-mono text-2xs text-fg-subtle">
                      {project.slug} · updated {formatRelativeTime(project.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isDemoProject(project.name) && <Badge variant="ember">Demo</Badge>}
                    <Badge variant={project.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {project.status}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
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
