/**
 * Last gate before anything reaches a model.
 *
 * Context is assembled from generated `.env` files, config, and source —
 * exactly the places credentials live. A secret that reaches a provider is
 * a secret that has left the machine and cannot be recalled, so this runs
 * unconditionally on the compiled text rather than being something a
 * caller opts into.
 *
 * It errs toward redacting: a false positive costs the model one
 * placeholder it did not need, a false negative costs a credential.
 */
export interface SanitizationResult {
  text: string;
  redactions: number;
  kinds: string[];
}

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Replacement keeps the shape so the model still sees "a key goes here". */
  replace: string;
}

const RULES: Rule[] = [
  {
    kind: 'provider-key',
    pattern: /\b(gsk|sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/g,
    replace: '<REDACTED_API_KEY>',
  },
  {
    kind: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    replace: '<REDACTED_API_KEY>',
  },
  { kind: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replace: '<REDACTED_TOKEN>' },
  { kind: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: '<REDACTED_AWS_KEY>' },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: '<REDACTED_JWT>',
  },
  {
    kind: 'bcrypt-hash',
    pattern: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,
    replace: '<REDACTED_HASH>',
  },
  {
    kind: 'connection-string',
    // Only the credentials portion; the host and database name are useful.
    pattern:
      /\b((?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis|amqp):\/\/)[^:@/\s]+:[^@/\s]+@/gi,
    replace: '$1<REDACTED>:<REDACTED>@',
  },
  {
    kind: 'assigned-secret',
    // `JWT_SECRET=...`, `"password": "..."`, `apiKey: '...'`
    // The leading name part must be optional: an earlier version required
    // at least one character before the keyword, which meant a bare
    // `password=` — the single most common spelling — was never redacted.
    pattern:
      /\b([A-Za-z0-9_]*(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',;}]{6,})\3/gi,
    replace: '$1$2$3<REDACTED>$3',
  },
  {
    kind: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: '<REDACTED_PRIVATE_KEY>',
  },
];

/**
 * Values that look like an assignment but are type declarations.
 *
 * A schema line reads `password_hash:VARCHAR(100)` — the key matches the
 * secret-name rule and the value is 6+ characters, so a naive pass redacts
 * it. That is not a secret, it is the column's type, and losing it makes
 * the context worse for exactly the task that needed it. Over-redaction is
 * still a cost; the rule is minimum sufficient context, not minimum
 * possible information.
 */
const TYPE_DECLARATION =
  /^(?:var)?char\s*\(|^n?varchar|^text\b|^n?char\b|^int(?:eger)?\b|^bigint\b|^smallint\b|^tinyint\b|^decimal\s*\(|^numeric\s*\(|^float\b|^double\b|^bool(?:ean)?\b|^date(?:time)?\b|^timestamp\b|^time\b|^json\b|^uuid\b|^enum\s*\(|^blob\b|^string\b|^number\b|^null\b|^undefined\b|^true\b|^false\b/i;

export function sanitizeContext(text: string): SanitizationResult {
  let output = text;
  let redactions = 0;
  const kinds: string[] = [];

  for (const rule of RULES) {
    let hits = 0;
    output = output.replace(rule.pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2) as string[];

      // A named-secret assignment whose value is a type declaration is a
      // schema line, not a credential. Leave it intact.
      if (rule.kind === 'assigned-secret' && TYPE_DECLARATION.test((groups[3] ?? '').trim())) {
        return match;
      }

      hits += 1;
      return rule.replace.replace(/\$(\d)/g, (_, index: string) => groups[Number(index) - 1] ?? '');
    });

    if (hits > 0) {
      redactions += hits;
      kinds.push(rule.kind);
    }
  }

  return { text: output, redactions, kinds };
}
