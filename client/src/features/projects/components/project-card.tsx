import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import { formatDate } from '@/shared/lib/format';
import type { Project, ProjectStatus } from '@/shared/types/api';

const statusVariant: Record<ProjectStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Card className="transition-colors hover:border-line-strong">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-fg">{project.name}</h3>
            <p className="mt-0.5 font-mono text-2xs text-fg-subtle">{project.slug}</p>
          </div>
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
