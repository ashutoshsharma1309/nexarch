import { ArrowRight, Hammer } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Card, CardContent } from '@/shared/components/ui/card';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useProjects } from '@/shared/hooks/use-projects';
import { RecentProjects } from './components/recent-projects';
import { StatCard } from './components/stat-card';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const projects = useProjects();
  const projectCount = projects.data?.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="console/dashboard"
        title="Overview"
        description="Your workspace at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Projects"
          value={String(projectCount)}
          hint="Applications in this workspace"
          loading={projects.isPending}
        />
        <StatCard label="Generations" value="0" hint="Pipeline runs to date" />
        <StatCard
          label="Modules online"
          value="5/9"
          hint="health, analysis, architecture, database, api"
        />
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ember-soft text-ember">
              <Hammer className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-fg">Forge an application</h2>
              <p className="mt-0.5 text-xs text-fg-muted">
                Describe what you want to build — stack, auth, admin, the lot.
              </p>
            </div>
          </div>
          <Link
            to="/forge"
            className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ember hover:text-ember-hover"
          >
            Open the forge
            <ArrowRight className="size-3.5" />
          </Link>
        </CardContent>
      </Card>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-fg">Recent projects</h2>
        <RecentProjects />
      </section>
    </>
  );
}
