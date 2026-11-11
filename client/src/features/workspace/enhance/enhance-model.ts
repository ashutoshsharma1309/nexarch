/**
 * The rules of the enhancement form, apart from the components that show them.
 *
 * The limits mirror the server's, so the form can answer before a round trip.
 */
import type { AttachedImage } from '../tabs/edit/image-field';

export const INSTRUCTION_MIN = 8;
export const INSTRUCTION_MAX = 2_000;
export const MAX_REFERENCE_LINKS = 5;

/** Automatic leaves the choice to the server, which states its reason. */
export type ResearchMode = 'auto' | 'on' | 'off';

export interface ComposedEnhancement {
  instruction: string;
  referenceUrls: string[];
  research: ResearchMode;
  image: AttachedImage | null;
}

export type ReferenceLinks = { ok: true; urls: string[] } | { ok: false; error: string };

/** One address per line. Refuses anything that is not plain http(s). */
export function parseReferenceLinks(raw: string): ReferenceLinks {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const urls: string[] = [];
  for (const line of lines) {
    let parsed: URL;
    try {
      parsed = new URL(line);
    } catch {
      return { ok: false, error: `“${line}” is not a full address. Start it with https://.` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: `“${line}” is not a web address. Only http and https work.` };
    }
    if (parsed.username !== '' || parsed.password !== '') {
      return { ok: false, error: `“${line}” contains a sign-in. Remove it and try again.` };
    }
    if (!urls.includes(parsed.href)) urls.push(parsed.href);
  }
  if (urls.length > MAX_REFERENCE_LINKS) {
    return {
      ok: false,
      error: `That is ${String(urls.length)} links; the limit is ${String(MAX_REFERENCE_LINKS)}.`,
    };
  }
  return { ok: true, urls };
}

/**
 * The request as the server will read it.
 *
 * Enhancement planning takes one instruction string, so the links travel
 * inside it. That is all they do: nothing here opens them.
 */
export function instructionWithLinks(instruction: string, urls: readonly string[]): string {
  if (urls.length === 0) return instruction;
  return `${instruction}\n\nReference sites the owner pointed to:\n${urls.join('\n')}`;
}

/** The server's value for each research choice. */
export function researchPayload(mode: ResearchMode): { research?: boolean } {
  if (mode === 'on') return { research: true };
  if (mode === 'off') return { research: false };
  return {};
}

const KIND_LABEL: Record<string, string> = {
  'research-features': 'Research and add features',
  'redesign-page': 'Redesign a page',
  'improve-visuals': 'Improve the visuals',
  'add-backend': 'Add backend',
  'add-database': 'Add a database',
  'add-authentication': 'Add authentication',
  'integrate-api': 'Integrate an API',
  'add-module': 'Add a module',
  'improve-performance': 'Improve performance',
  'fix-bug': 'Fix a bug',
  'improve-mobile': 'Improve mobile',
  refactor: 'Refactor',
  'improve-accessibility': 'Improve accessibility',
  'add-tests': 'Add tests',
  general: 'General change',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  researching: 'Researching',
  planning: 'Planning',
  implementing: 'Changing the code',
  testing: 'Building and testing it',
  repairing: 'Repairing what failed',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

/** Falls back to the server's own word: a new stage must still be readable. */
export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}
