/**
 * Finds the parts of a project a request is really about.
 *
 * Sending every file would be expensive and worse: the model loses the
 * relevant fifty lines in the other ten thousand. So files are scored from the
 * request's own words and the kind of change, and only the best are read in
 * full. The file list itself is always included, as paths only, so the plan
 * can name files the scoring missed.
 */
import type { EnhancementKind } from '../enhancement.types.js';

const STOP_WORDS = new Set(
  'the a an and or to of in on for with my our your this that it is are be add make improve please can you new use using into from page app site'.split(
    ' ',
  ),
);

/** Paths each kind of change usually has to read, before any word matching. */
const KIND_HINTS: Partial<Record<EnhancementKind, RegExp>> = {
  'add-authentication':
    /(auth|login|register|session|user|middleware|schema\.prisma|api-?client|\.env\.example|router|routes|app\.tsx)/i,
  'add-database': /(schema\.prisma|prisma|repositor|service|model|\.env\.example|config)/i,
  'integrate-api': /(service|client|config|\.env\.example|routes?)/i,
  'add-backend': /(backend\/src\/(app|index|server|routes?)|router|\.env\.example|api-?client)/i,
  'add-module': /(router|routes?|nav|sidebar|layout|app\.tsx)/i,
  'improve-visuals': /(\.css$|theme|tokens|tailwind|layout|hero|landing|home)/i,
  'redesign-page': /(pages?\/|features\/|layout|\.css$)/i,
  'improve-mobile': /(\.css$|layout|nav|header|sidebar|tailwind)/i,
  'improve-accessibility': /(layout|nav|form|button|input|modal|\.tsx$)/i,
  'improve-performance': /(router|vite\.config|app\.tsx|service|repositor)/i,
  'add-tests': /(\.test\.|\.spec\.|package\.json|service|controller)/i,
};

const IGNORED = /(^|\/)(package-lock\.json|node_modules\/|dist\/|\.next\/)/;
const MAX_CONTENT_SCAN = 40_000;

export interface ScoredFile {
  path: string;
  score: number;
}

export function requestTerms(instruction: string): string[] {
  const words = instruction
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 30);
}

/** Pure, so which files a request reaches for can be asserted directly. */
export function scoreFiles(
  files: readonly { path: string; content: string }[],
  instruction: string,
  kind: EnhancementKind,
): ScoredFile[] {
  const terms = requestTerms(instruction);
  const hint = KIND_HINTS[kind];
  const scored: ScoredFile[] = [];
  for (const file of files) {
    if (IGNORED.test(file.path)) continue;
    const lowerPath = file.path.toLowerCase();
    const body = file.content.slice(0, MAX_CONTENT_SCAN).toLowerCase();
    let score = hint?.test(file.path) ? 4 : 0;
    for (const term of terms) {
      if (lowerPath.includes(term)) score += 5;
      else if (body.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ path: file.path, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export interface ContextBundle {
  /** Full text of the best files, bounded. */
  excerpts: { path: string; content: string; truncated: boolean }[];
  /** Every path in the project, for naming files the scoring missed. */
  manifest: string[];
  candidates: string[];
}

const MAX_EXCERPT_FILES = 14;
const MAX_EXCERPT_CHARS = 8_000;
const MAX_TOTAL_CHARS = 60_000;
const MAX_MANIFEST = 400;

export function assembleContext(
  files: readonly { path: string; content: string }[],
  scored: readonly ScoredFile[],
): ContextBundle {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const excerpts: ContextBundle['excerpts'] = [];
  let total = 0;
  for (const entry of scored.slice(0, MAX_EXCERPT_FILES)) {
    const content = byPath.get(entry.path);
    if (content === undefined) continue;
    const slice = content.slice(0, MAX_EXCERPT_CHARS);
    if (total + slice.length > MAX_TOTAL_CHARS) break;
    total += slice.length;
    excerpts.push({
      path: entry.path,
      content: slice,
      truncated: slice.length < content.length,
    });
  }
  return {
    excerpts,
    manifest: files.map((file) => file.path).slice(0, MAX_MANIFEST),
    candidates: scored.slice(0, 30).map((entry) => entry.path),
  };
}

export function excerptsForPrompt(bundle: ContextBundle): string {
  return bundle.excerpts
    .map(
      (entry) => `--- ${entry.path}${entry.truncated ? ' (truncated)' : ''} ---\n${entry.content}`,
    )
    .join('\n\n');
}
