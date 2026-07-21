/**
 * Extracts `imports` edges between scanned files. This is intentionally not
 * a real TS/JS parser (no new AST dependency) — a regex over `from '...'`
 * specifiers plus a small resolver that understands the two path
 * conventions the generators actually emit (relative `.js`-suffixed ESM
 * specifiers on the backend, `@/`-aliased specifiers on the frontend) is
 * exact enough for generated code, which never has been minified or
 * otherwise obscured.
 */
import type { GraphEdge } from '../dependency-graph.types.js';
import { fileNodeId } from './node-id.js';
import type { ScannedFile, ScannedProject } from './project-scanner.js';

const FROM_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;

function extractSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const match of content.matchAll(FROM_SPECIFIER)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  for (const match of content.matchAll(SIDE_EFFECT_IMPORT)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveImportPath(
  fromPath: string,
  specifier: string,
  byPath: Map<string, ScannedFile>,
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null; // external package — no node for it

  let base: string;
  if (specifier.startsWith('@/')) {
    base = `src/${specifier.slice(2)}`;
  } else {
    const stack = fromPath.split('/').slice(0, -1);
    for (const part of specifier.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    base = stack.join('/');
  }
  base = base.replace(/\.js$/, '');

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  for (const candidate of candidates) {
    if (byPath.has(candidate)) return candidate;
  }
  return null;
}

export function buildImportEdges(project: ScannedProject): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const file of project.files) {
    for (const specifier of extractSpecifiers(file.content)) {
      const resolved = resolveImportPath(file.path, specifier, project.byPath);
      if (!resolved || resolved === file.path) continue;

      const from = fileNodeId(file.path);
      const to = fileNodeId(resolved);
      const id = `imports:${from}->${to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, from, to, type: 'imports' });
    }
  }

  return edges;
}
