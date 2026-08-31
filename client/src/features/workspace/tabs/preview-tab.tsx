/**
 * Run this project's generated application on localhost.
 *
 * The Local Run Engine and the preview surface are untouched — this tab is
 * the project-scoped way in. Reaching preview used to mean holding on to a
 * run id; now it is a tab on the project, and the run it previews is the
 * one the project last completed.
 */
import { PreviewWorkspace } from '@/features/preview/preview-page';
import { useWorkspace } from '../workspace-context';
import { BuildRequiredState } from './build-required-state';

export function PreviewTab() {
  const workspace = useWorkspace();

  if (!workspace.latestRun) return <BuildRequiredState what="a preview" />;
  if (!workspace.artifacts) {
    return (
      <BuildRequiredState
        what="a preview"
        missing={workspace.artifactsMissing}
        loading={!workspace.artifactsMissing}
      />
    );
  }
  return <PreviewWorkspace artifacts={workspace.artifacts} />;
}
