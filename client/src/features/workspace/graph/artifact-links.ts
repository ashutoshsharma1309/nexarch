/**
 * Where a node's source artifact lives in the workspace.
 *
 * Phase 3 records `sourceArtifactId` on every node — the artifact type it
 * was derived from. Phase 2 put each artifact behind a workspace tab. This
 * maps one to the other, so "View source" lands somewhere real.
 *
 * A type with no destination returns null and the UI says so, rather than
 * offering a link that goes nowhere.
 */
export interface ArtifactTarget {
  /** Path relative to the project workspace root. */
  path: string;
  label: string;
}

const TARGETS: Record<string, ArtifactTarget> = {
  'requirement-spec': { path: 'requirements', label: 'Requirements' },
  'architecture-plan': { path: 'architecture', label: 'Architecture' },
  'architecture-markdown': { path: 'architecture', label: 'Architecture' },
  'database-design': { path: 'database', label: 'Database' },
  'api-contract': { path: 'database', label: 'API contract' },
  'backend-source': { path: 'code', label: 'Code' },
  'frontend-source': { path: 'code', label: 'Code' },
  'project-files': { path: 'code', label: 'Code' },
  'security-report': { path: 'intelligence', label: 'Security' },
  'dependency-graph': { path: 'intelligence/dependencies', label: 'Dependencies' },
};

export function artifactTarget(
  projectId: string,
  sourceArtifactId: string | null,
): { href: string; label: string } | null {
  if (!sourceArtifactId) return null;
  const target = TARGETS[sourceArtifactId];
  if (!target) return null;
  return { href: `/projects/${projectId}/${target.path}`, label: target.label };
}
