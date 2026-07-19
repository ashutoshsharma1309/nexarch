import { FolderGit2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Badge } from '@/shared/components/ui/badge';
import { useProjects } from '@/shared/hooks/use-projects';
import { formatDate } from '@/shared/lib/format';

export function RecentProjects() {
  const projects = useProjects();
  const navigate = useNavigate();

  if (projects.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const recent = (projects.data ?? []).slice(0, 5);

  if (recent.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 className="size-4" />}
        title="No projects yet"
        description="Forge your first application from a plain-language description."
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
    );
  }

  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {recent.map((project) => (
        <li key={project.id}>
          <Link
            to="/projects"
            className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-raised/60"
          >
            <div>
              <p className="text-sm font-medium text-fg">{project.name}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Updated {formatDate(project.updatedAt)}
              </p>
            </div>
            <Badge variant={project.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {project.status}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
