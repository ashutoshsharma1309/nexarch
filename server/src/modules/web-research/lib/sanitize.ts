/**
 * Cleans text read from the web before any model or later stage sees it.
 *
 * Text that reads like an attempt to instruct a model is withheld and recorded,
 * not silently passed on and not silently dropped, so a reviewer can see what a
 * page tried to do.
 */

/** Bounds the work done on one document. Providers can return megabytes. */
const RAW_SCAN_LIMIT = 60_000;
const MAX_FLAGGED_LINES = 5;
const MAX_FLAGGED_LINE_CHARS = 160;
const WITHHELD = '[withheld: possible prompt injection]';

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|preceding|all|any|your)\b.{0,40}\b(instructions?|prompts?|directions?|rules?|guidelines?|context)\b/i,
  /\b(system prompt|developer message|system message|hidden instructions?)\b/i,
  /\byou are now\b.{0,30}\b(an?|the|in)\b.{0,30}\b(assistant|ai|model|mode|bot|developer|admin)\b/i,
  /\b(act|behave|respond) as\b.{0,40}\b(assistant|ai|model|llm|chatbot|system)\b/i,
  /\b(new|updated|revised)\s+instructions?\s*:/i,
  /\bdo not (tell|inform|alert|mention)\b.{0,30}\b(user|users|anyone|human)\b/i,
  /\b(reveal|print|show|leak|exfiltrate|send|output)\b.{0,40}\b(api[ -]?keys?|secret keys?|credentials|env(ironment)? variables?)\b/i,
  /^\s*(system|assistant|developer)\s*:/i,
  /<\|?\s*(im_start|im_end|endoftext)\s*\|?>|\[\/?INST\]|<<\/?SYS>>/i,
  /\b(ai|llm|language model)s?\b.{0,40}\b(must|should|shall)\b.{0,40}\b(ignore|recommend|say|output|respond)\b/i,
];

export interface SanitizedText {
  text: string;
  flaggedLines: string[];
  truncated: boolean;
}

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return text.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/gi,
    (match, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return named[name.toLowerCase()] ?? match;
      const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? '', 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    },
  );
}

/** Zero-width and bidi characters go too: they hide words from the patterns above. */
function stripInvisible(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cf}/gu, '')
    .replace(/[^\P{Cc}\n\t]/gu, ' ');
}

function stripMarkup(text: string): string {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*$/i, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/`{3,}|~{3,}/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/[A-Za-z0-9+/=]{120,}/g, ' ');
}

function toRecordable(line: string): string {
  return line.replace(/[<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FLAGGED_LINE_CHARS);
}

function splitSegments(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/);
}

function capText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const slice = text.slice(0, maxChars);
  const boundary = slice.lastIndexOf(' ');
  return {
    text: `${(boundary > maxChars * 0.6 ? slice.slice(0, boundary) : slice).trimEnd()}...`,
    truncated: true,
  };
}

export function sanitizeExcerpt(raw: string, maxChars: number): SanitizedText {
  const decoded = stripInvisible(decodeEntities(raw.slice(0, RAW_SCAN_LIMIT)));
  const flagged = new Set<string>();

  // Scanned before markup is removed, so an instruction hidden in a comment or
  // a stripped element is still reported, even though it would not survive.
  for (const line of decoded.split('\n')) {
    for (const segment of splitSegments(line)) {
      if (looksLikeInjection(segment)) flagged.add(toRecordable(segment));
    }
  }

  const kept: string[] = [];
  for (const line of stripMarkup(decoded).split('\n')) {
    const segments = splitSegments(line.replace(/\s+/g, ' ').trim()).map((segment) => {
      if (!looksLikeInjection(segment)) return segment;
      flagged.add(toRecordable(segment));
      return WITHHELD;
    });
    const cleaned = segments
      .filter((segment, index) => segment !== WITHHELD || segments[index - 1] !== WITHHELD)
      .join(' ')
      .trim();
    if (cleaned !== '') kept.push(cleaned);
  }

  const capped = capText(kept.join('\n'), maxChars);
  return {
    text: capped.text,
    flaggedLines: [...flagged].filter(Boolean).slice(0, MAX_FLAGGED_LINES),
    truncated: capped.truncated,
  };
}
