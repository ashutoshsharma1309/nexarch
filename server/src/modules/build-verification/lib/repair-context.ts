/**
 * What the repair model is shown of the files a failure implicated.
 *
 * A file too large to send whole used to be dropped, which meant the very file
 * a type error named was the one the model never saw. An excerpt around the
 * reported lines is enough to fix it, and is safe to edit from: edits are
 * applied to the whole file and a `find` must match exactly once there.
 */
import { redactString } from '../../../shared/security/redact.js';
import type { ProjectFile, VerificationResult } from '../build-verification.types.js';
import { failedSteps } from './repair-targets.js';

const MAX_FILE_CHARS = 20_000;
const MAX_FILES_CHARS = 60_000;
const MIN_USEFUL_CHARS = 800;
const CONTEXT_LINES = 40;
const HEAD_LINES = 30;
const MAX_ERROR_LINES = 20;

/** The 1-based lines a failure's output reports in this file. */
function reportedLines(path: string, verification: VerificationResult): number[] {
  const relative = path.split('/').slice(1).join('/');
  const found = new Set<number>();
  for (const step of failedSteps(verification)) {
    for (const line of step.output.split('\n')) {
      const name = line.includes(path)
        ? path
        : relative && line.includes(relative)
          ? relative
          : null;
      if (name === null) continue;
      const at = line.indexOf(name) + name.length;
      // tsc prints path(12,3); vite, esbuild and stack traces print path:12:3.
      const position = /^(?:\((\d+),\d+\)|:(\d+)(?::\d+)?)/.exec(line.slice(at));
      const reported = Number.parseInt(position?.[1] ?? position?.[2] ?? '', 10);
      if (Number.isFinite(reported) && reported > 0) found.add(reported);
    }
  }
  return [...found].sort((a, b) => a - b).slice(0, MAX_ERROR_LINES);
}

interface Region {
  from: number;
  to: number;
}

function mergeRegions(regions: Region[]): Region[] {
  const merged: Region[] = [];
  for (const region of [...regions].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && region.from <= last.to + 1) last.to = Math.max(last.to, region.to);
    else merged.push({ ...region });
  }
  return merged;
}

/** Head for the imports, then the reported regions, while they fit. */
function excerpt(
  path: string,
  content: string,
  reported: readonly number[],
  limit: number,
): string {
  const lines = content.split('\n');
  const wanted = mergeRegions([
    { from: 1, to: Math.min(HEAD_LINES, lines.length) },
    ...reported.map((line) => ({
      from: Math.max(1, line - CONTEXT_LINES),
      to: Math.min(lines.length, line + CONTEXT_LINES),
    })),
  ]);

  const parts: string[] = [];
  const shown: string[] = [];
  let used = 0;
  let previousEnd = 0;
  for (const region of wanted) {
    const body = lines.slice(region.from - 1, region.to).join('\n');
    if (used + body.length > limit) break;
    used += body.length;
    if (region.from > previousEnd + 1) {
      parts.push(`... [lines ${String(previousEnd + 1)}-${String(region.from - 1)} omitted] ...`);
    }
    parts.push(body);
    shown.push(`${String(region.from)}-${String(region.to)}`);
    previousEnd = region.to;
  }
  if (shown.length === 0) {
    // One line longer than the limit, as minified output can be.
    return `--- ${path} (first ${String(limit)} characters only.) ---\n${redactString(content.slice(0, limit))}`;
  }
  if (previousEnd < lines.length) {
    parts.push(`... [lines ${String(previousEnd + 1)}-${String(lines.length)} omitted] ...`);
  }
  const header = `--- ${path} (excerpt of a ${String(lines.length)}-line file: lines ${shown.join(', ')}. Every "find" must come from the text shown here.) ---`;
  return `${header}\n${redactString(parts.join('\n'))}`;
}

export function renderRepairFiles(
  files: readonly ProjectFile[],
  targets: readonly string[],
  verification: VerificationResult,
  limitations: string[],
): { text: string; included: string[] } {
  const sections: string[] = [];
  const included: string[] = [];
  let total = 0;
  for (const path of targets) {
    const content = files.find((file) => file.path === path)?.content;
    if (content === undefined) continue;
    const room = Math.min(MAX_FILE_CHARS, MAX_FILES_CHARS - total);
    if (room < MIN_USEFUL_CHARS) {
      limitations.push(`${path} was not sent for repair: the context limit was already used`);
      continue;
    }
    let section: string;
    if (content.length <= room) {
      section = `--- ${path} ---\n${redactString(content)}`;
    } else {
      const reported = reportedLines(path, verification);
      section = excerpt(path, content, reported, room);
      limitations.push(
        reported.length > 0
          ? `${path} is too large to send whole, so the regions around its reported errors were sent`
          : `${path} is too large to send whole and the failure gave no line number, so only its start was sent`,
      );
    }
    total += section.length;
    included.push(path);
    sections.push(section);
  }
  return { text: sections.join('\n\n'), included };
}
