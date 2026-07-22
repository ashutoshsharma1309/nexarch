import { Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import { DropdownMenu } from '@/shared/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/cn';
import { formatDate } from '@/shared/lib/format';
import type { Project, ProjectStatus } from '@/shared/types/api';

const statusVariant: Record<ProjectStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

export interface ProjectCardActions {
  onRename: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  onToggleArchive: (project: Project) => void;
  onToggleFavorite: (project: Project) => void;
  onDelete: (project: Project) => void;
}

export function ProjectCard({ project, ...actions }: { project: Project } & ProjectCardActions) {
  const navigate = useNavigate();

  return (
    <Card className="transition-colors hover:border-line-strong">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              void navigate(`/projects/${project.id}`);
            }}
          >
            <h3 className="truncate text-sm font-medium text-fg">{project.name}</h3>
            <p className="mt-0.5 font-mono text-2xs text-fg-subtle">{project.slug}</p>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={project.favorite ? 'Unfavorite' : 'Favorite'}
              onClick={() => {
                actions.onToggleFavorite(project);
              }}
              className={cn(
                'flex size-6 items-center justify-center rounded-sm hover:bg-raised',
                project.favorite ? 'text-ember' : 'text-fg-subtle',
              )}
            >
              <Star className={cn('size-3.5', project.favorite && 'fill-current')} />
            </button>
            <DropdownMenu
              trigger={
                <span className="flex size-6 items-center justify-center rounded-sm text-fg-subtle hover:bg-raised hover:text-fg">
                  ⋯
                </span>
              }
              items={[
                {
                  label: 'Rename',
                  onSelect: () => {
                    actions.onRename(project);
                  },
                },
                {
                  label: 'Duplicate',
                  onSelect: () => {
                    actions.onDuplicate(project);
                  },
                },
                {
                  label: project.status === 'ARCHIVED' ? 'Unarchive' : 'Archive',
                  onSelect: () => {
                    actions.onToggleArchive(project);
                  },
                },
                {
                  label: 'Delete',
                  destructive: true,
                  onSelect: () => {
                    actions.onDelete(project);
                  },
                },
              ]}
            />
          </div>
        </div>
        <div className="mt-2">
          <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
        </div>
        {project.description && (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-fg-muted">
            {project.description}
          </p>
        )}
        <p className="mt-3 text-2xs text-fg-subtle">Updated {formatDate(project.updatedAt)}</p>
      </CardContent>
    </Card>
  );
}
