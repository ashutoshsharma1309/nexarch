/**
 * The sections of a project, in the order the work happens.
 *
 * Slugs are URLs and some predate their labels: `intelligence` is now Quality
 * and Tests, `execution` is Activity History. Bookmarks and redirects depend on
 * the slug, so a rename changes the label and leaves the path alone.
 *
 * One list drives the sidebar, the phone tab row, the breadcrumb and the
 * document title, so they cannot disagree.
 */
import {
  ClipboardCheck,
  Database,
  DraftingCompass,
  FileCode2,
  Hammer,
  History,
  ListChecks,
  MonitorPlay,
  PanelsTopLeft,
  PencilRuler,
  Telescope,
  Waypoints,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface WorkspaceSection {
  /** Path under `/projects/:id`. Empty for the index. */
  slug: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface WorkspaceSectionGroup {
  label: string;
  sections: readonly WorkspaceSection[];
}

export const WORKSPACE_SECTION_GROUPS: readonly WorkspaceSectionGroup[] = [
  {
    label: 'Define',
    sections: [
      { slug: '', label: 'Overview', icon: PanelsTopLeft },
      { slug: 'research', label: 'Research', icon: Telescope },
      { slug: 'requirements', label: 'Requirements', icon: ListChecks },
      { slug: 'architecture', label: 'Architecture', icon: DraftingCompass },
    ],
  },
  {
    label: 'Make',
    sections: [
      { slug: 'agents', label: 'Agents', icon: Workflow },
      { slug: 'build', label: 'Build', icon: Hammer },
      { slug: 'code', label: 'Code', icon: FileCode2 },
      { slug: 'database', label: 'Database', icon: Database },
    ],
  },
  {
    label: 'Inspect',
    sections: [
      { slug: 'graph', label: 'Knowledge Graph', icon: Waypoints },
      { slug: 'preview', label: 'Preview', icon: MonitorPlay },
      { slug: 'intelligence', label: 'Quality and Tests', icon: ClipboardCheck },
      { slug: 'execution', label: 'Activity History', icon: History },
    ],
  },
  {
    label: 'Improve',
    sections: [{ slug: 'enhance', label: 'Enhance', icon: PencilRuler }],
  },
];

export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = WORKSPACE_SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

export function workspaceSectionPath(projectId: string, slug: string): string {
  return slug ? `/projects/${projectId}/${slug}` : `/projects/${projectId}`;
}
