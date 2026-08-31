import { GraphWorkspace } from '@/features/workspace/graph/graph-workspace';
import { useWorkspace } from '../../workspace-context';

export function GraphSection() {
  const workspace = useWorkspace();
  if (!workspace.project) return null;
  return <GraphWorkspace projectId={workspace.project.id} />;
}
