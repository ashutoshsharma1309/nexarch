/**
 * The project workspace shell: breadcrumbs, project header, tab bar, and
 * the active section.
 *
 * Everything a project *is* lives under one URL here. That is the point of
 * the phase — the console used to expose NexArch's internal modules as
 * twenty sibling destinations, which described how the platform is built
 * rather than what the user is doing.
 *
 * The header's primary action is deliberately a single button whose label
 * follows the project's real state: Build it, watch it build, or build it
 * again. There is never a second thing competing for that position.
 */
import {
  Boxes,
  Database,
  DraftingCompass,
  FileCode2,
  Hammer,
  LayoutGrid,
  ListChecks,
  MonitorPlay,
  Sparkles,
} from 'lucide-react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/shared/components/breadcrumbs';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Tabs } from '@/shared/components/ui/tabs';
import { Button } from '@/shared/components/ui/button';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { ProjectHeader } from './project-header';
import { ProjectWorkspaceContext } from './workspace-context';
import { useProjectWorkspace } from './use-project-workspace';

/** The workspace sections, in order. One list drives the tabs, the
 * breadcrumb trail and the document title. */
const TABS = [
  { slug: '', label: 'Overview', icon: LayoutGrid },
  { slug: 'requirements', label: 'Requirements', icon: ListChecks },
  { slug: 'build', label: 'Build', icon: Hammer },
  { slug: 'architecture', label: 'Architecture', icon: DraftingCompass },
  { slug: 'database', label: 'Database', icon: Database },
  { slug: 'code', label: 'Code', icon: FileCode2 },
  { slug: 'intelligence', label: 'Intelligence', icon: Sparkles },
  { slug: 'preview', label: 'Preview', icon: MonitorPlay },
] as const;

/** Sections that nest their own routes, for the breadcrumb's third level. */
const SUBSECTIONS: Record<string, string> = {
  'intelligence/validation': 'Validation',
  'intelligence/repairs': 'Self-Repair',
  'intelligence/security': 'Security',
  'intelligence/dependencies': 'Dependencies',
  'intelligence/graph': 'Engineering Graph',
};

function tabsFor(id: string) {
  return TABS.map((tab) => ({
    to: tab.slug ? `/projects/${id}/${tab.slug}` : `/projects/${id}`,
    label: tab.label,
    icon: tab.icon,
    end: tab.slug === '',
  }));
}

export function ProjectWorkspaceLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const { pathname } = useLocation();
  const workspace = useProjectWorkspace(projectId);

  // Segment 3 is the section; segment 4, where present, is a subsection
  // (Intelligence nests its own routes).
  const [, , , sectionSlug, subSlug] = pathname.split('/');
  const section = TABS.find((tab) => tab.slug === sectionSlug);
  const subLabel = subSlug ? SUBSECTIONS[`${sectionSlug ?? ''}/${subSlug}`] : undefined;

  useDocumentTitle(
    workspace.project
      ? section
        ? `${subLabel ?? section.label} · ${workspace.project.name}`
        : workspace.project.name
      : 'Project',
  );

  if (!projectId) return <Navigate to="/projects" replace />;

  if (workspace.notFound) {
    return (
      <>
        <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: 'Not found' }]} />
        <EmptyState
          icon={<Boxes className="size-4" />}
          title="This project doesn’t exist"
          description="It may have been deleted, or the link may belong to a different account."
          action={
            <Button
              variant="primary"
              onClick={() => {
                window.location.href = '/projects';
              }}
            >
              Back to projects
            </Button>
          }
        />
      </>
    );
  }

  if (workspace.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading project">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-16" />
        <Skeleton className="h-9" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (workspace.error || !workspace.project) {
    return (
      <>
        <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: 'Error' }]} />
        <EmptyState
          icon={<Boxes className="size-4" />}
          title="This project couldn’t be loaded"
          description={workspace.error?.message ?? 'The API did not return this project.'}
          action={
            <Button
              variant="primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Try again
            </Button>
          }
        />
      </>
    );
  }

  return (
    <ProjectWorkspaceContext.Provider value={workspace}>
      <Breadcrumbs
        items={[
          { label: 'Projects', to: '/projects' },
          { label: workspace.project.name, to: `/projects/${projectId}` },
          ...(section?.slug
            ? [
                subLabel
                  ? { label: section.label, to: `/projects/${projectId}/${section.slug}` }
                  : { label: section.label },
              ]
            : []),
          ...(subLabel ? [{ label: subLabel }] : []),
        ]}
      />
      <ProjectHeader workspace={workspace} />
      <Tabs items={tabsFor(projectId)} className="mb-6" />
      <Outlet />
    </ProjectWorkspaceContext.Provider>
  );
}
