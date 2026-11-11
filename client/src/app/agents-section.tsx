/**
 * The Agents section of a project: the agent mesh, on the project's own brief.
 *
 * It runs on the newest prompt this project was built from, because that is
 * the only brief the project actually has. A project that has never been
 * built has none, and the panel keeps its start action disabled until it does.
 */
import { AgentRunPanel } from '@/features/workspace/tabs/agent-run-panel';
import { useWorkspace } from '@/features/workspace/workspace-context';
import { PageHeader } from '@/shared/components/page-header';

export function AgentsSection() {
  const workspace = useWorkspace();
  const project = workspace.project;
  if (!project) return null;

  const prompt = workspace.runs[0]?.prompt ?? '';

  return (
    <section aria-label="Agents">
      <PageHeader
        variant="section"
        title="Agents"
        description={
          prompt
            ? 'Run the agent mesh on the most recent prompt for this project. Every status shown is reported by the server.'
            : 'The agent mesh needs a brief to work from. Describe this project on the Build section first.'
        }
      />
      <AgentRunPanel projectId={project.id} prompt={prompt} />
    </section>
  );
}
