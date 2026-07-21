/**
 * Tracks project generations as a version history, keyed by project name.
 * In-memory only — this platform has no persistence layer for generated
 * projects (every generator is a pure function of its inputs), so "the
 * history of this project's regenerations within the current server
 * process" is the same continuity model the Security Engine's report cache
 * already relies on.
 */
import type { ProjectManifest, VersionRecord } from '../dependency-graph.types.js';

const manifests = new Map<string, ProjectManifest>();

export function recordVersion(
  projectName: string,
  changeRequest: string | null,
  filesRegenerated: string[],
  filesPreserved: string[],
  filesManual: string[],
): ProjectManifest {
  const existing = manifests.get(projectName) ?? { projectName, currentVersion: 0, versions: [] };
  const version = existing.currentVersion + 1;

  const record: VersionRecord = {
    version,
    createdAt: new Date().toISOString(),
    changeRequest,
    filesRegenerated,
    filesPreserved,
    filesManual,
    summary: changeRequest
      ? `${changeRequest} — ${filesRegenerated.length} file(s) regenerated, ${filesPreserved.length} preserved`
      : `Initial build — ${filesRegenerated.length} file(s) generated`,
  };

  const updated: ProjectManifest = {
    projectName,
    currentVersion: version,
    versions: [...existing.versions, record],
  };
  manifests.set(projectName, updated);
  return updated;
}

export function getManifest(projectName: string): ProjectManifest | null {
  return manifests.get(projectName) ?? null;
}
