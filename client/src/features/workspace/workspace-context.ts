/**
 * The resolved workspace, shared with every tab.
 *
 * Context rather than each tab calling `useProjectWorkspace` itself: the
 * chain it resolves (project → runs → artifacts) would otherwise be
 * re-derived per tab, and — more importantly — `publishArtifacts` would
 * fire from several places at once. One owner, one publish.
 */
import { createContext, useContext } from 'react';

import type { ProjectWorkspace } from './use-project-workspace';

export const ProjectWorkspaceContext = createContext<ProjectWorkspace | null>(null);

export function useWorkspace(): ProjectWorkspace {
  const value = useContext(ProjectWorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside a project workspace route');
  return value;
}
