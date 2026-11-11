/**
 * Which packages a change added.
 *
 * Plan approval happens before any file is written, so a person cannot see
 * these when they approve. Web content can influence the plan, and a package
 * a project imports runs as this server's user, so the names matter.
 */
const GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function isManifest(path: string): boolean {
  const segments = path.split('/');
  return segments.at(-1) === 'package.json' && !segments.includes('node_modules');
}

function namesIn(content: string): Set<string> {
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    return new Set(
      GROUPS.flatMap((group) => Object.keys((manifest[group] ?? {}) as Record<string, unknown>)),
    );
  } catch {
    return new Set();
  }
}

/** `path: name` for each package a manifest declares that its baseline did not. */
export function addedDependencies(
  baseline: readonly { path: string; content: string }[],
  workspace: ReadonlyMap<string, string>,
): string[] {
  const before = new Map(baseline.map((file) => [file.path, file.content]));
  const added: string[] = [];
  for (const [path, content] of workspace) {
    if (!isManifest(path)) continue;
    const known = namesIn(before.get(path) ?? '{}');
    for (const name of namesIn(content)) {
      if (!known.has(name)) added.push(`${path}: ${name}`);
    }
  }
  return added;
}
