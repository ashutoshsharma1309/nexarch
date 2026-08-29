/**
 * Targeted edits, and nothing more.
 *
 * The temptation with a UX agent is to hand the whole frontend to a model
 * and take back whatever it returns. That is a rewrite, not an
 * improvement: it discards working code, it cannot be reviewed, and the
 * second run produces a different app than the first for no stated reason.
 *
 * So improvements here are surgical and mechanical. Each one:
 *
 *   - fixes a problem a check actually observed,
 *   - matches an exact pattern in machine-generated source,
 *   - is expressed as a before/after pair that a person can read, and
 *   - leaves every file it does not match completely untouched.
 *
 * A transformation that cannot state precisely what it replaced does not
 * belong in this file. The regexes are safe for the same reason the
 * frontend's contract check is: this is code NexArch emitted, in a shape
 * NexArch controls, not arbitrary source found in the wild.
 */
import type { UxImprovement, UxImprovementSet } from '../../../shared/types/generation.js';

export interface EditableFile {
  path: string;
  content: string;
}

/** Truncates a fragment for the audit record without losing its identity. */
function fragment(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

type Transform = (file: EditableFile) => { content: string; improvements: UxImprovement[] } | null;

/**
 * Adds the toast import when an edit introduced the first call to it.
 *
 * Shared by both mutation transforms: whichever runs first must leave the
 * file importable, and whichever runs second must not add the import twice.
 */
function ensureToastImport(content: string): string {
  if (content.includes("from '@/shared/store/toast.store'")) return content;
  const anchor = /^import .*?;$/m.exec(content);
  if (!anchor?.[0]) return content;
  return content.replace(
    anchor[0],
    `${anchor[0]}\n\nimport { toast } from '@/shared/store/toast.store';`,
  );
}

/**
 * Surfaces the server's rejection.
 *
 * The generated pages call `mutate(payload, { onSuccess: … })`. When the
 * request fails, nothing runs — the dialog stays open, the button
 * un-presses, and the user is given no reason. This adds an `onError` that
 * reports the message the server actually sent.
 *
 * The emitted pages already import the toast store for other purposes in
 * some shapes and not others, so the import is added only when absent.
 */
const addMutationErrorHandling: Transform = (file) => {
  if (!file.path.endsWith('Page.tsx')) return null;
  if (!file.content.includes('.mutate(')) return null;

  const improvements: UxImprovement[] = [];
  let content = file.content;

  /*
   * Matches the generated option object that has an onSuccess and no
   * onError. The `[^}]*` is bounded to a single object literal body, which
   * is exactly the shape the generator emits — no nesting to get lost in.
   */
  const pattern = /\{\s*onSuccess:\s*\(\)\s*=>\s*\{([^{}]*)\}\s*,?\s*\}/g;

  content = content.replace(pattern, (match, body: string) => {
    if (match.includes('onError')) return match;
    const replacement = `{
          onSuccess: () => {${body}},
          onError: (error) => {
            toast(error instanceof Error ? error.message : 'The request failed', 'error');
          },
        }`;
    improvements.push({
      file: file.path,
      category: 'STATE',
      description:
        'A failed write now reports the server’s reason instead of doing nothing visible.',
      before: fragment(match),
      after: fragment(replacement),
    });
    return replacement;
  });

  if (improvements.length === 0) return null;
  return { content: ensureToastImport(content), improvements };
};

/**
 * The other shape the generator emits: `mutate(value)` with no options at
 * all.
 *
 * Two generated screens take this form, and both are worse than a failed
 * save. A failed delete closes the confirm dialog and leaves the row
 * exactly where it was, which reads as a delete that silently undid
 * itself. And the login page — `login.mutate(values)` inside a submit
 * handler — shows a wrong password *nothing at all*: no message, no
 * indication the request happened, just the form as it was.
 *
 * The match is deliberately narrow: a single identifier or member
 * expression, with the closing paren followed only by `;` or another `)`.
 * That covers the bare statement and the call nested inside a submit
 * handler, and cannot touch a call that already passes an options object.
 */
const addMissingMutationOptions: Transform = (file) => {
  if (!file.path.endsWith('Page.tsx')) return null;
  if (!file.content.includes('.mutate(')) return null;

  const improvements: UxImprovement[] = [];
  const content = file.content.replace(
    /\.mutate\((\s*[A-Za-z_$][\w$.]*\s*)\)(?=\s*[;)])/g,
    (match, argument: string) => {
      const replacement = `.mutate(${argument.trim()}, {
            onError: (error) => {
              toast(error instanceof Error ? error.message : 'The request failed', 'error');
            },
          })`;
      improvements.push({
        file: file.path,
        category: 'STATE',
        description:
          'A destructive action that failed now says so, instead of closing the dialog as though it had worked.',
        before: fragment(match),
        after: fragment(replacement),
      });
      return replacement;
    },
  );

  if (improvements.length === 0) return null;
  return { content: ensureToastImport(content), improvements };
};

/**
 * Finds the extent of a JSX opening tag starting at `from`.
 *
 * Written as a scanner rather than a regex because a regex got this wrong
 * in a way a build caught: `<button ... ref={(el) => {…}} type="button">`
 * contains a `>` inside an arrow function, so a `[^>]*` lookahead stopped
 * there, concluded the tag had no `type`, and added a second one. The
 * generated file then failed to compile with "JSX elements cannot have
 * multiple attributes with the same name".
 *
 * Tracking brace depth and quotes is the only way to know where a JSX tag
 * actually ends. Returns -1 if the tag is unterminated, which callers
 * treat as "leave this alone".
 */
function openingTagEnd(content: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = from; i < content.length; i += 1) {
    const char = content[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return i;
  }
  return -1;
}

/**
 * Gives a bare `<button>` an explicit type.
 *
 * Inside a form, a button with no type submits it. A generated "clear
 * search" or "close" control that silently submits the form around it is
 * the kind of bug that only appears when a user presses Enter.
 */
const addButtonType: Transform = (file) => {
  if (!file.path.endsWith('.tsx')) return null;

  const improvements: UxImprovement[] = [];
  let content = file.content;

  // Right to left, so each replacement cannot shift the offsets of the
  // matches still to be processed.
  const starts = [...content.matchAll(/<button\b/g)].map((match) => match.index);

  for (const start of starts.reverse()) {
    const end = openingTagEnd(content, start);
    if (end === -1) continue;

    const tag = content.slice(start, end + 1);
    if (/\btype=/.test(tag)) continue;

    improvements.push({
      file: file.path,
      category: 'ACCESSIBILITY',
      description: 'An untyped button no longer submits the form it sits inside by default.',
      before: fragment(tag),
      after: fragment(`<button type="button"${tag.slice('<button'.length)}`),
    });
    content = `${content.slice(0, start)}<button type="button"${content.slice(start + '<button'.length)}`;
  }

  return improvements.length > 0 ? { content, improvements } : null;
};

const TRANSFORMS: readonly Transform[] = [
  addMutationErrorHandling,
  addMissingMutationOptions,
  addButtonType,
];

/**
 * Applies every transform to every file, and reports what it left alone.
 *
 * `filesUnchanged` is not decoration. It is the evidence that this was a
 * review rather than a regeneration, and a run where it approaches zero is
 * a run worth questioning.
 */
export function applyUxImprovements(files: readonly EditableFile[]): {
  files: EditableFile[];
  set: UxImprovementSet;
} {
  const improvements: UxImprovement[] = [];
  const changed = new Set<string>();

  const updated = files.map((file) => {
    let current = file;
    for (const transform of TRANSFORMS) {
      const result = transform(current);
      if (!result) continue;
      current = { path: current.path, content: result.content };
      improvements.push(...result.improvements);
      changed.add(current.path);
    }
    return current;
  });

  return {
    files: updated,
    set: {
      improvements,
      filesChanged: [...changed],
      filesUnchanged: files.length - changed.size,
    },
  };
}
