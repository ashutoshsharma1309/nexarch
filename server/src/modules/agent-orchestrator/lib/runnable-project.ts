/**
 * The generation mesh's output, as a project you can run.
 *
 * The agents publish their work split by concern — source separate from
 * config, manifest separate from both — because that is what lets the
 * frontend engineer read the backend's *manifest* without being handed
 * seventy files it has no use for. That split is right for agents and
 * wrong for a runner, which needs one flat list of paths under `backend/`
 * and `frontend/`.
 *
 * This is the one place that reassembles them, and it does it the same way
 * the pipeline always has, so the existing Preview and Local Run receive
 * exactly the shape they already understand. Nothing about the runner
 * changes to accommodate agents.
 */
import type { ArtifactType } from '../../../shared/contracts/index.js';

export interface ProjectFile {
  path: string;
  content: string;
}

type Artifacts = Partial<Record<ArtifactType, unknown>>;

function filesOf(artifact: unknown): ProjectFile[] {
  const value = artifact as { files?: ProjectFile[] } | undefined;
  return value?.files ?? [];
}

/**
 * Merges one area's source and config under a directory prefix.
 *
 * Source is applied after config so that a UX revision — which republishes
 * `frontend-source` and nothing else — wins over the version config was
 * written alongside. Last writer wins, and the last writer is the agent
 * that most recently touched the file.
 */
function area(artifacts: Artifacts, prefix: string, types: ArtifactType[]): ProjectFile[] {
  const byPath = new Map<string, string>();
  for (const type of types) {
    for (const file of filesOf(artifacts[type])) byPath.set(file.path, file.content);
  }
  return [...byPath.entries()].map(([path, content]) => ({ path: `${prefix}/${path}`, content }));
}

/**
 * Every file the mesh produced, ready for the runner.
 *
 * Returns an empty list when nothing was generated — a planning-only run
 * has no project to preview, and an empty list says so more honestly than
 * a directory tree containing nothing.
 */
export function runnableFiles(artifacts: Artifacts): ProjectFile[] {
  return [
    ...area(artifacts, 'backend', ['backend-config', 'backend-source']),
    ...area(artifacts, 'frontend', ['frontend-config', 'frontend-source']),
  ];
}
