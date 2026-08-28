/**
 * Deterministic compression.
 *
 * Every transform here is reversible in meaning: nothing technical is
 * summarized away, and no model is involved. The savings come from removing
 * what carries no information for the reader — repeated whitespace,
 * timestamps a generator stamped, database ids, and metadata keys that
 * describe storage rather than design.
 *
 * The rule that governs all of it: if losing a field could change what the
 * model produces, it is not compression, it is data loss.
 */
export interface CompressionOutcome {
  text: string;
  applied: string[];
  tokensSaved: number;
}

/** Keys that describe how a thing is stored, not what it is. */
const NOISE_KEYS = new Set([
  'id',
  'projectId',
  'runId',
  'createdAt',
  'updatedAt',
  'generatedAt',
  'canonicalName',
  'sourceArtifactId',
  'timestamp',
]);

/**
 * Strips storage metadata from a plain object tree.
 *
 * Applied to artifact JSON *before* it is stringified into a section, so
 * the model never spends tokens on a cuid or an ISO timestamp it cannot
 * use.
 */
export function stripNoise(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripNoise(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (NOISE_KEYS.has(key)) continue;
    if (item === null || item === undefined) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    output[key] = stripNoise(item, depth + 1);
  }
  return output;
}

const BLANK_RUNS = /\n{3,}/g;
const TRAILING_SPACE = /[ \t]+$/gm;

export function compress(text: string, countTokens: (text: string) => number): CompressionOutcome {
  const before = countTokens(text);
  const applied: string[] = [];

  let output = text;

  const collapsed = output.replace(TRAILING_SPACE, '').replace(BLANK_RUNS, '\n\n');
  if (collapsed !== output) {
    applied.push('whitespace');
    output = collapsed;
  }

  // Consecutive identical lines are an artifact of concatenating similar
  // structures; one is as informative as six.
  const lines = output.split('\n');
  const deduped: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== '' && deduped.at(-1)?.trim() === trimmed) continue;
    deduped.push(line);
  }
  if (deduped.length !== lines.length) {
    applied.push('duplicate-lines');
    output = deduped.join('\n');
  }

  output = output.trim();
  const after = countTokens(output);

  return { text: output, applied, tokensSaved: Math.max(0, before - after) };
}
