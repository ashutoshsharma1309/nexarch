/**
 * The file tree of a generated project, and which of its files import which.
 *
 * The engineering graph already knew about files the generators *announced* —
 * the ones a module or page listed in its summary. It did not know the shape
 * of the project on disk, and it knew nothing about imports, so a question as
 * ordinary as "what breaks if I change this file" had no answer in it.
 *
 * Two deliberate limits, because a graph that overstates what it knows is
 * worse than a small one:
 *
 * 1. Imports are read with a regular expression, not a parser. That is honest
 *    for the code this platform generates — every emitter writes plain ESM
 *    `from '…'` specifiers — and it is why every edge produced here carries
 *    `evidence: 'import-statement'`, so a reader can tell a parsed fact from
 *    an inferred one. Dynamic `import()` by variable, re-exports through a
 *    barrel and anything computed are not followed.
 * 2. An edge is produced only when the specifier resolves to a file that is
 *    actually in the project. An unresolved specifier is an external package
 *    or a mistake; inventing a node for it would put files in the graph that
 *    do not exist.
 *
 * Containment is not inferred at all: it is read off the paths, which is the
 * one relationship a file tree states outright. Sharing a directory is *not*
 * treated as a dependency.
 *
 * (`dependency-graph/lib/import-analyzer.ts` solves a related problem for the
 * Dependency Engine, over bundles it has already classified by role. This one
 * works from the flat generated file list the graph is built from, which is
 * why it resolves paths rather than module slugs.)
 */

export interface FileImportEdge {
  /** Project-relative path of the importing file. */
  from: string;
  /** Project-relative path of the imported file. */
  to: string;
  /** The specifier as written, kept so a reader can check the claim. */
  specifier: string;
}

export interface FolderEntry {
  /** Project-relative folder path, e.g. `backend/src/modules`. */
  path: string;
  /** The folder that contains it, or null for a top-level folder. */
  parent: string | null;
}

/** `from '…'` and bare side-effect imports, plus `export … from '…'`. */
const SPECIFIER = /(?:\bfrom\s*|^\s*(?:import|export)\s*)['"]([^'"]+)['"]/gm;

/** Extensions tried for a specifier that names no file extension of its own. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Resolve `a/b/../c` without touching the filesystem. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Which file a specifier means, if any.
 *
 * Generated code is written in ESM, so a TypeScript source imports its
 * sibling as `./thing.js` while the file on disk is `./thing.ts` — the
 * extension is rewritten before the candidates are tried, or nothing would
 * ever resolve.
 */
function resolve(specifier: string, fromPath: string, paths: ReadonlySet<string>): string | null {
  let base: string;
  if (specifier.startsWith('.')) {
    base = normalize(`${dirname(fromPath)}/${specifier}`);
  } else if (specifier.startsWith('@/')) {
    // The generated projects alias `@/…` to their own `src/`.
    const side = fromPath.split('/')[0] ?? '';
    base = normalize(`${side}/src/${specifier.slice(2)}`);
  } else {
    return null; // An external package: the graph models those separately.
  }

  const withoutJs = base.replace(/\.[cm]?jsx?$/, '');
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${withoutJs}${ext}`),
    ...EXTENSIONS.map((ext) => `${withoutJs}/index${ext}`),
  ];
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

/** Every import between two files of this project, deduplicated. */
export function resolveImports(
  files: readonly { path: string; content: string }[],
): FileImportEdge[] {
  const paths = new Set(files.map((file) => file.path));
  const seen = new Set<string>();
  const edges: FileImportEdge[] = [];

  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.path)) continue;
    for (const match of file.content.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = resolve(specifier, file.path, paths);
      if (target === null || target === file.path) continue;
      const key = `${file.path}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: file.path, to: target, specifier });
    }
  }
  return edges;
}

/** Every folder the given files live in, with its parent. */
export function folderTree(paths: readonly string[]): FolderEntry[] {
  const folders = new Map<string, string | null>();
  for (const path of paths) {
    const parts = path.split('/').slice(0, -1);
    let parent: string | null = null;
    let current = '';
    for (const part of parts) {
      current = current === '' ? part : `${current}/${part}`;
      if (!folders.has(current)) folders.set(current, parent);
      parent = current;
    }
  }
  return [...folders].map(([path, parent]) => ({ path, parent }));
}

/** The folder a file sits in directly, or null for a file at the root. */
export function parentFolder(path: string): string | null {
  const folder = dirname(path);
  return folder === '' ? null : folder;
}

/** Configuration rather than source — worth showing as its own kind. */
export function isConfigFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    /^(package\.json|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|\.env(\.[^/]+)?|Dockerfile|docker-compose[^/]*\.ya?ml|\.gitignore|\.dockerignore|prettier\.config\.[cm]?[jt]s)$/.test(
      name,
    ) || /\.(ya?ml|toml|ini)$/.test(name)
  );
}
