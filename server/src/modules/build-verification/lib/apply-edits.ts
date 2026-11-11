/**
 * Applies a model's edits, trusting none of them.
 *
 * An edit is honoured only if it names a file the failure pointed at and its
 * `find` occurs exactly once. A manifest that comes out invalid, or asks to
 * run something the runner would refuse, is discarded whole: a repair must
 * not be a way around the rules a generation has to follow.
 */
import { checkProjectPolicy, describeViolations } from '../../runner/lib/script-policy.js';
import type { ProjectFile } from '../build-verification.types.js';

export interface ModelEdit {
  file: string;
  find: string;
  replace: string;
}

const MAX_EDITS = 12;

/** The well-formed edits in a model's reply. Throws on a reply that is not JSON. */
export function parseEdits(content: string): ModelEdit[] {
  const parsed = JSON.parse(content) as { edits?: unknown };
  if (!Array.isArray(parsed.edits)) return [];
  const edits: ModelEdit[] = [];
  for (const entry of parsed.edits.slice(0, MAX_EDITS) as Record<string, unknown>[]) {
    if (
      typeof entry.file === 'string' &&
      typeof entry.find === 'string' &&
      typeof entry.replace === 'string' &&
      entry.find.length > 0
    ) {
      edits.push({ file: entry.file, find: entry.find, replace: entry.replace });
    }
  }
  return edits;
}

function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

/**
 * The file's own text for a `find` that differs only in indentation.
 *
 * Models routinely reflow leading whitespace on a fragment they otherwise
 * copied exactly, and refusing that loses a correct fix. Only whole lines
 * compared after trimming qualify, and only a unique match is returned, so a
 * tolerant match cannot land anywhere an exact one could not have.
 */
function matchIgnoringIndent(text: string, fragment: string): string | null {
  const wanted = fragment.split('\n').map((line) => line.trim());
  while (wanted.length > 0 && wanted[0] === '') wanted.shift();
  while (wanted.length > 0 && wanted[wanted.length - 1] === '') wanted.pop();
  if (wanted.length === 0) return null;

  const lines = text.split('\n');
  let found: string | null = null;
  for (let start = 0; start + wanted.length <= lines.length; start += 1) {
    const candidate = lines.slice(start, start + wanted.length);
    if (!candidate.every((line, index) => line.trim() === wanted[index])) continue;
    if (found !== null) return null;
    found = candidate.join('\n');
  }
  return found;
}

function manifestProblem(file: ProjectFile): string | null {
  if (!file.path.endsWith('package.json')) return null;
  try {
    JSON.parse(file.content);
  } catch {
    return 'the edit left invalid JSON';
  }
  const violations = checkProjectPolicy([file]);
  return violations.length > 0 ? describeViolations(violations) : null;
}

export interface AppliedEdits {
  files: ProjectFile[];
  changed: string[];
  rejected: string[];
}

export function applyEdits(
  files: readonly ProjectFile[],
  targets: readonly string[],
  edits: readonly ModelEdit[],
): AppliedEdits {
  const allowed = new Set(targets);
  const updated = new Map<string, string>();
  const rejected: string[] = [];

  for (const edit of edits) {
    if (!allowed.has(edit.file)) {
      rejected.push(`${edit.file}: not one of the files this failure pointed at`);
      continue;
    }
    const current =
      updated.get(edit.file) ?? files.find((file) => file.path === edit.file)?.content;
    if (current === undefined) {
      rejected.push(`${edit.file}: no such file`);
      continue;
    }
    const count = occurrences(current, edit.find);
    const target =
      count === 1 ? edit.find : count === 0 ? matchIgnoringIndent(current, edit.find) : null;
    if (target === null) {
      rejected.push(`${edit.file}: fragment occurs ${String(count)} times, expected exactly once`);
      continue;
    }
    if (edit.find === edit.replace) continue;
    updated.set(
      edit.file,
      current.replace(target, () => edit.replace),
    );
  }

  for (const [path, content] of [...updated]) {
    const problem = manifestProblem({ path, content });
    if (problem) {
      updated.delete(path);
      rejected.push(`${path}: ${problem}`);
    }
  }

  return {
    files: files.map((file) => ({
      path: file.path,
      content: updated.get(file.path) ?? file.content,
    })),
    changed: [...updated.keys()],
    rejected,
  };
}
