import { FolderGit2, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useProjects } from '@/shared/hooks/use-projects';
import { ProjectCard } from './components/project-card';

export function ProjectsPage() {
  useDocumentTitle('Projects');
  const navigate = useNavigate();
  const projects = useProjects();
  const [query, setQuery] = useState('');

  const filtered = (projects.data ?? []).filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

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
              void navigate('/forge');
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
            <ProjectCard key={project.id} project={project} />
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
          description="Projects appear here after their first generation run. Start by describing one in the forge."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('/forge');
              }}
            >
              Open the forge
            </Button>
          }
        />
      )}
    </>
  );
}
