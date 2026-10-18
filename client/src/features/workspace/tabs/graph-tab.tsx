/**
 * The Knowledge Graph as a destination of its own.
 *
 * It used to be the sixth item inside the Intelligence tab's sub-navigation,
 * two clicks and one guess away from anyone who had not already found it —
 * which is a strange place for the one view that answers "what is this
 * project made of, and what depends on what". It now sits beside Preview and
 * Rebuild, where the other answers about a built project live. The old
 * Intelligence link redirects here, so nothing bookmarked is lost.
 */
import { GraphWorkspace } from '@/features/workspace/graph/graph-workspace';
import { useWorkspace } from '../workspace-context';
import { BuildRequiredState } from './build-required-state';

export function GraphTab() {
  const workspace = useWorkspace();

  // A graph of a project that was never built would be a graph of nothing.
  if (!workspace.latestRun) return <BuildRequiredState what="a knowledge graph" />;
  if (!workspace.project) return null;

  return <GraphWorkspace projectId={workspace.project.id} latestRunId={workspace.latestRun.id} />;
}
