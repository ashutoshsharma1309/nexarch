/**
 * One place that turns a secret into its shape.
 *
 * The platform already has three redaction sites — the context sanitizer
 * before the model, the source-security scanner's `redact`, the runtime
 * validator's `scrub` — each shaped for its own caller. This is the
 * general one, for logs and audit events, where the input is an arbitrary
 * value rather than a known field. It errs toward over-redacting: a log
 * line that loses a token to a false positive is a nuisance; a log line
 * that keeps one is an incident.
 *
 * `redactValue` walks objects and arrays so a structured log payload is
 * scrubbed whole — `{ authorization: 'Bearer …' }` never reaches the
 * transport with the bearer intact, whether or not the caller remembered
 * to redact it.
 */

/** Substrings in a key that mark its value as sensitive. */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|api[_-]?key|apikey|credential|authorization|cookie|session|jwt|private[_-]?key|access[_-]?token|refresh[_-]?token|database[_-]?url|conn(ection)?[_-]?string/i;

/**
 * Values that are themselves secrets regardless of their key.
 *
 * The provider-key pattern deliberately does not require a leading word
 * boundary: a fake key pasted as `TEST_gsk_abc…` has an underscore, not a
 * boundary, before `gsk_`, and a redactor that missed it would be the leak
 * it exists to prevent. The assigned-credential pattern mirrors the context
 * sanitizer's, so a `SOMETHING_KEY=value` line is scrubbed in a log exactly
 * as it is scrubbed before the model.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /(?:gsk|sk|pk|rk)_[A-Za-z0-9]{12,}/g, // provider keys, boundary-agnostic
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, // bearer tokens
  /\beyJ[A-Za-z0-9._-]{16,}\b/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^:\s'"]+:[^@\s'"]{3,}@/gi, // credentials in a URL
  // `SECRET=…`, `API_KEY: '…'`, `password="…"` — the assignment form.
  /\b([A-Za-z0-9_]*(?:secret|password|passwd|token|api[_-]?key|apikey|credential|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',;}]{6,})\3/gi,
];

/** The assignment pattern keeps its key and mask, dropping only the value. */
const ASSIGNMENT_INDEX = SECRET_VALUE_PATTERNS.length - 1;

/** Redacts secret-shaped substrings inside a string. */
export function redactString(value: string): string {
  let out = value;
  SECRET_VALUE_PATTERNS.forEach((pattern, index) => {
    out =
      index === ASSIGNMENT_INDEX
        ? out.replace(pattern, (_match, key: string, sep: string) => `${key}${sep}***`)
        : out.replace(pattern, '***');
  });
  return out;
}

/**
 * Redacts a value of any shape.
 *
 * Depth-bounded so a cyclic or pathological payload cannot hang the
 * logger — a log call is not worth an event-loop stall. The default of 6
 * is tuned for log payloads, which are shallow; a caller with a deep but
 * finite, cycle-free document (a project package is the case) passes a
 * larger `maxDepth`, because truncating real structure into a marker
 * string would corrupt the document, and deeper traversal only *widens*
 * secret coverage — every level is still checked by key and by value.
 */
export function redactValue(value: unknown, depth = 0, maxDepth = 6): unknown {
  if (depth > maxDepth) return '[redacted-depth]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1, maxDepth));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '***' : redactValue(entry, depth + 1, maxDepth);
    }
    return out;
  }
  return value;
}
