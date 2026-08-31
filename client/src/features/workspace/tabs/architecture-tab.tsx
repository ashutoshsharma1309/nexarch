/**
 * The architecture the planner produced.
 *
 * Renders the existing Architecture view unchanged — decisions, folder
 * structure, API modules, entities, dependency summary. The visual
 * Engineering Graph belongs to a later phase; when it lands it becomes
 * another panel in this tab, which is why the tab is a thin frame around
 * the section rather than a layout the graph would have to fight.
 */
import { ArchitectureWorkspace } from '@/features/architecture/architecture-page';
import { useWorkspace } from '../workspace-context';
import { BuildRequiredState } from './build-required-state';

export function ArchitectureTab() {
  const workspace = useWorkspace();

  if (!workspace.latestRun) return <BuildRequiredState what="the architecture" />;
  if (!workspace.artifacts) {
    return (
      <BuildRequiredState
        what="the architecture"
        missing={workspace.artifactsMissing}
        loading={!workspace.artifactsMissing}
      />
    );
  }
  return <ArchitectureWorkspace />;
}
