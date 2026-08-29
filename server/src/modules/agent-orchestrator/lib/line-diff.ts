/**
 * A small line diff, for changesets a person will actually read.
 *
 * Standard LCS over lines, grouped into hunks. Generated files are a few
 * hundred lines and repairs change a handful of them, which is exactly the
 * regime where the quadratic table is fine and pulling in a diff library
 * for one call site is not.
 */
import type { DiffHunk } from '../../../shared/types/repair.js';

export interface LineDiff {
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export function diffLines(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');

  // LCS table.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i];
    if (!row) continue;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  // Walk the table, collecting removed/added runs into hunks.
  const hunks: DiffHunk[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  let current: DiffHunk | null = null;

  const flush = (): void => {
    if (current && (current.removed.length > 0 || current.added.length > 0)) hunks.push(current);
    current = null;
  };

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (
      j < b.length &&
      (i >= a.length || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))
    ) {
      current ??= { line: i + 1, removed: [], added: [] };
      current.added.push(b[j] ?? '');
      added += 1;
      j += 1;
    } else if (i < a.length) {
      current ??= { line: i + 1, removed: [], added: [] };
      current.removed.push(a[i] ?? '');
      removed += 1;
      i += 1;
    }
  }
  flush();

  return { added, removed, hunks };
}
