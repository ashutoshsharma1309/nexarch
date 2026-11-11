/**
 * Applying a model's change to one file, exactly or not at all.
 *
 * A find-and-replace whose `find` text is not in the file means the model was
 * working from something other than the file. Fuzzy matching would apply the
 * change to whatever it landed on, so a miss is reported as a miss, along with
 * what the file really says there, so the next attempt can be corrected.
 */
export interface FileEdit {
  find: string;
  replace: string;
}

export type PatchOutcome = { ok: true; content: string } | { ok: false; reason: string };

const WORD = /\w+/g;
const MAX_HINT_CHARS = 200;

/** The lines most like the model's search text, numbered. Feedback only: never applied. */
function closestLines(content: string, find: string): string {
  const longest = find
    .split('\n')
    .map((line) => line.trim())
    .sort((a, b) => b.length - a.length)[0];
  const wanted = new Set(longest?.match(WORD) ?? []);
  if (wanted.size === 0) return '';
  const ranked = content
    .split('\n')
    .flatMap((line, index) => {
      const words = line.match(WORD) ?? [];
      const shared = words.filter((word) => wanted.has(word)).length;
      const score = shared / wanted.size;
      return score >= 0.5 ? [{ line: index + 1, text: line.trim(), score }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (ranked.length === 0) return '';
  const rows = ranked.map(
    (entry) => `  line ${String(entry.line)}: ${entry.text.slice(0, MAX_HINT_CHARS)}`,
  );
  return `\nThe closest lines in the file are:\n${rows.join('\n')}`;
}

/**
 * Applies every edit that can be applied and reports every one that cannot, so
 * one retry can correct them all. Nothing is returned unless all of them held.
 */
export function applyEdits(content: string, edits: readonly FileEdit[]): PatchOutcome {
  if (edits.length === 0) return { ok: false, reason: 'The change contained no edits.' };
  let working = content;
  const failures: string[] = [];
  for (const [index, edit] of edits.entries()) {
    const label = `Edit ${String(index + 1)}`;
    if (edit.find === '') {
      failures.push(`${label} had empty search text.`);
      continue;
    }
    const first = working.indexOf(edit.find);
    if (first === -1) {
      const span = matchAsPromptShowedIt(working, edit.find);
      if (span === 'ambiguous') {
        failures.push(
          `${label} matched more than one place in the file: ${edit.find.slice(0, 120)}`,
        );
      } else if (span !== null) {
        working = working.slice(0, span.start) + edit.replace + working.slice(span.end);
      } else {
        failures.push(
          `${label} searched for text that is not in the file: ${edit.find.slice(0, 120)}${closestLines(working, edit.find)}`,
        );
      }
      continue;
    }
    // A second match means the model's search text is ambiguous, and
    // replacing the first one might change the wrong place.
    if (working.includes(edit.find, first + edit.find.length)) {
      failures.push(`${label} matched more than one place in the file: ${edit.find.slice(0, 120)}`);
      continue;
    }
    working = working.slice(0, first) + edit.replace + working.slice(first + edit.find.length);
  }
  if (failures.length > 0) return { ok: false, reason: failures.join('\n') };
  if (working === content) {
    return { ok: false, reason: 'The edits left the file exactly as it was.' };
  }
  return { ok: true, content: working };
}

/** A placeholder standing in for code a whole-file answer left out. */
const ELIDED_CODE =
  /(?:\/\/|\/\*|\{\/\*|#|<!--)\s*(?:\.\.\.|…|\brest of\b|\bremaining\b|\bexisting\b.*\b(?:code|content|logic|unchanged)\b|\bunchanged\b)/i;

/** Why a whole-file answer cannot replace `existing`, or null when it can. */
export function wholeFileProblem(existing: string, replacement: string): string | null {
  if (replacement === existing) return 'The answer returned the file exactly as it was.';
  const elided = replacement.split('\n').find((line) => ELIDED_CODE.test(line));
  if (elided !== undefined && !existing.includes(elided.trim())) {
    return `The answer left part of the file out and put this in its place: ${elided.trim().slice(0, 120)}`;
  }
  // Well short of the original means something was dropped or the answer was
  // cut off, and either would delete working code.
  if (existing.length > 400 && replacement.length < existing.length * 0.35) {
    return `The answer was ${String(replacement.length)} characters against the file's ${String(existing.length)}, so it would have deleted most of it.`;
  }
  return null;
}

const STUB_MARKER = /\bNotImplementedError\b|not implemented yet/gi;

/** A change that adds a "not implemented" placeholder has not delivered anything. */
export function addsStub(existing: string | undefined, replacement: string): boolean {
  const before = existing?.match(STUB_MARKER)?.length ?? 0;
  const after = replacement.match(STUB_MARKER)?.length ?? 0;
  return after > before;
}

const COMMENT_LINE = /^\s*\/\/.*$/;

interface KeptLine {
  text: string;
  start: number;
  end: number;
}

/** The lines the prompt compressor leaves: no comment or blank lines, no back-to-back repeats. */
function keptLines(text: string): KeptLine[] {
  const kept: KeptLine[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (trimmed === '' || COMMENT_LINE.test(line)) continue;
    if (kept.at(-1)?.text === trimmed) {
      const last = kept.at(-1);
      if (last) last.end = start + line.length;
      continue;
    }
    kept.push({
      text: trimmed,
      start: start + (line.length - line.trimStart().length),
      end: start + line.length,
    });
  }
  return kept;
}

/**
 * Finds whole-line search text the way the model was shown the file.
 *
 * Prompts are compressed before sending, which removes comment lines and
 * repeated lines, so a multi-line `find` copied faithfully from the prompt can
 * miss the real file. This applies that same known transform to both sides. It
 * is not fuzzy: every remaining line must match, and only once.
 */
function matchAsPromptShowedIt(
  content: string,
  find: string,
): { start: number; end: number } | 'ambiguous' | null {
  const wanted = keptLines(find).map((line) => line.text);
  if (wanted.length === 0) return null;
  const lines = keptLines(content);
  const hits: number[] = [];
  for (let index = 0; index + wanted.length <= lines.length; index += 1) {
    if (wanted.every((text, offset) => lines[index + offset]?.text === text)) hits.push(index);
  }
  if (hits.length > 1) return 'ambiguous';
  const hit = hits[0];
  if (hit === undefined) return null;
  const first = lines[hit];
  const last = lines[hit + wanted.length - 1];
  return first && last ? { start: first.start, end: last.end } : null;
}

/** Provider keys and private keys. A generated file must never carry one. */
const EMBEDDED_SECRET =
  /(sk-[a-z0-9-]{20,}|sk_live_[a-z0-9]{10,}|gsk_[a-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[a-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

/**
 * Whether a planned write carries a credential. Refused outright: the file
 * would be stored, served to the preview and shown in a diff.
 */
export function carriesSecret(content: string): boolean {
  return EMBEDDED_SECRET.test(content);
}

/** The signature-like lines of a file, enough to code against it without its body. */
export function signaturesOf(content: string, maxChars = 1_500): string {
  const lines = content
    .split('\n')
    .filter((line) =>
      /^\s*(export\s|import\s|interface\s|type\s|model\s|enum\s|router\.\w+\(|app\.\w+\()/.test(
        line,
      ),
    );
  return lines.join('\n').slice(0, maxChars);
}
