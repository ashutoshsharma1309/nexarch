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
interface SecretPattern {
  pattern: RegExp;
  /**
   * How the match is rewritten. The default replaces the whole match, which
   * is right for a bare secret; a pattern that captures the name the secret
   * was given keeps that name, because "which credential leaked" is the one
   * useful thing in a redacted line.
   */
  replace?: (...groups: string[]) => string;
}

/**
 * Each pattern carries its own replacement.
 *
 * This used to be a bare array plus an index constant pointing at the last
 * entry, which was the "keep the key, mask the value" one. Appending a
 * pattern after it silently moved that behaviour onto the wrong entry — so
 * the rule now travels with the pattern it belongs to.
 */
const SECRET_VALUE_PATTERNS: SecretPattern[] = [
  { pattern: /(?:gsk|sk|pk|rk)_[A-Za-z0-9]{12,}/g }, // provider keys, boundary-agnostic
  // Hyphenated keys (`sk-or-v1-…`, `sk-ant-…`, `sk-proj-…`). This one does need
  // a boundary before it: "task-management-dashboard" contains `sk-` too.
  { pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g },
  // Google API keys. `AIza` plus 35 characters, and the Gemini adapter puts
  // one in a URL query parameter (see gemini-provider.ts), where none of the
  // patterns below would have caught it: the parameter is named `key`, which
  // the assignment form does not treat as sensitive on its own. A 429 from
  // that endpoint carries the whole URL in its message.
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}/g },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi }, // bearer tokens
  { pattern: /\beyJ[A-Za-z0-9._-]{16,}\b/g }, // JWTs
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s'"]+:[^@\s'"]{3,}@/gi }, // credentials in a URL
  {
    // `SECRET=…`, `API_KEY: '…'`, `password="…"` — the assignment form.
    pattern:
      /\b([A-Za-z0-9_]*(?:secret|password|passwd|token|api[_-]?key|apikey|credential|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',;}]{6,})\3/gi,
    replace: (_match, key, separator) => `${key}${separator}***`,
  },
  {
    // A credential carried as a URL query parameter. `key` counts here and
    // not in the assignment form above, because in a query string it is a
    // credential by convention while in prose it is an ordinary word.
    pattern:
      /([?&](?:key|token|secret|password|auth|credential|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token)=)[^&\s"'<>]{6,}/gi,
    replace: (_match, prefix) => `${prefix}***`,
  },
];

/** Redacts secret-shaped substrings inside a string. */
export function redactString(value: string): string {
  let out = value;
  for (const { pattern, replace } of SECRET_VALUE_PATTERNS) {
    out =
      replace === undefined
        ? out.replace(pattern, '***')
        : out.replace(pattern, (...groups: string[]) => replace(...groups));
  }
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
  // An Error must be described before it is walked. `message`, `stack` and
  // `cause` are non-enumerable, so `Object.entries` sees nothing and the
  // whole error redacts to `{}` — which is what every `logger.warn('…', {
  // error })` in this codebase was publishing instead of its reason.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack === undefined ? {} : { stack: redactString(value.stack) }),
      ...(value.cause === undefined
        ? {}
        : { cause: redactValue(value.cause, depth + 1, maxDepth) }),
    };
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '***' : redactValue(entry, depth + 1, maxDepth);
    }
    return out;
  }
  return value;
}
