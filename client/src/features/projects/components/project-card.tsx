import { MoreHorizontal, Star } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/shared/components/ui/badge';
import { DropdownMenu } from '@/shared/components/ui/dropdown-menu';
import { StatusDot } from '@/shared/components/ui/status-dot';
import { cn } from '@/shared/lib/cn';
import { formatDate } from '@/shared/lib/format';
import { isDemoProject } from '@/shared/lib/prompt-examples';
import type { Project } from '@/shared/types/api';
import { PROJECT_STATUS } from './project-status';

export interface ProjectCardActions {
  onRename: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  onExport: (project: Project) => void;
  onToggleArchive: (project: Project) => void;
  onToggleFavorite: (project: Project) => void;
  onDelete: (project: Project) => void;
}

/**
 * A project as a drawing title block: the name large, the description, and a
 * ruled strip of fields along the bottom edge. The whole block is the link
 * target through the name; the star and the menu sit above it.
 */
export function ProjectCard({ project, ...actions }: { project: Project } & ProjectCardActions) {
  const status = PROJECT_STATUS[project.status];

  return (
    <article className="relative flex flex-col rounded-lg border border-line bg-surface transition-colors focus-within:border-line-strong hover:border-line-strong">
      <div className="flex-1 px-4 pt-3.5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-base font-semibold tracking-tight text-fg">
            <Link
              to={`/projects/${project.id}`}
              className="line-clamp-2 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
            >
              {project.name}
            </Link>
          </h3>
          <div className="relative z-10 -mt-0.5 -mr-1.5 flex shrink-0 items-center">
            <button
              type="button"
              aria-label={
                project.favorite ? `Unfavorite ${project.name}` : `Favorite ${project.name}`
              }
              aria-pressed={project.favorite}
              onClick={() => {
                actions.onToggleFavorite(project);
              }}
              className={cn(
                'flex size-7 items-center justify-center rounded-sm transition-colors hover:bg-raised',
                project.favorite ? 'text-accent' : 'text-fg-subtle hover:text-fg',
              )}
            >
              <Star className={cn('size-3.5', project.favorite && 'fill-current')} />
            </button>
            <DropdownMenu
              triggerLabel={`Actions for ${project.name}`}
              trigger={
                <span className="flex size-7 items-center justify-center rounded-sm text-fg-subtle transition-colors hover:bg-raised hover:text-fg">
                  <MoreHorizontal className="size-4" aria-hidden="true" />
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
                  label: 'Export…',
                  onSelect: () => {
                    actions.onExport(project);
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
        {project.description && (
          <p className="mt-2 line-clamp-2 type-ui leading-relaxed text-fg-muted">
            {project.description}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[1fr_auto_auto] divide-x divide-line border-t border-line text-2xs">
        <div className="min-w-0 px-4 py-2">
          <dt className="sr-only">Slug</dt>
          <dd className="truncate font-mono text-fg-subtle">{project.slug}</dd>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2">
          <dt className="sr-only">Status</dt>
          <StatusDot tone={status.tone} />
          <dd className="text-fg-muted">{status.label}</dd>
          {isDemoProject(project.name) && <Badge className="ml-1">Demo</Badge>}
        </div>
        <div className="px-3 py-2">
          <dt className="sr-only">Updated</dt>
          <dd className="whitespace-nowrap text-fg-subtle tabular-nums">
            {formatDate(project.updatedAt)}
          </dd>
        </div>
      </dl>
    </article>
  );
}
