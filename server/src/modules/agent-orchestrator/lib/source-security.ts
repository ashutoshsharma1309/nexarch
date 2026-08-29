/**
 * Security checks that read the generated source.
 *
 * The existing Security Engine reads the *plan* — endpoints, roles, the
 * architecture's security section — and is good at it. What it cannot see
 * is the code: a key pasted into a config file, an `eval` on request data,
 * a CORS origin of `*`. Those live in files, so this reads files.
 *
 * Every check here is deterministic and every finding cites the line it
 * came from. That is not a stylistic preference — Step 8 asks for exactly
 * this division, and it is the right one: a regex that finds `eval(` is
 * both cheaper and more reliable than a model asked whether any dangerous
 * evaluation occurs, and it can point at line 41.
 *
 * The hard constraint in this file is redaction. A finding that reports a
 * hard-coded credential and quotes it has published the credential to
 * every reader of the review, the API response and the logs. `redact()`
 * runs on every piece of evidence before it leaves this module.
 */
import type { AgentFinding } from '../../../shared/contracts/index.js';

export interface SourceFile {
  path: string;
  content: string;
}

/** Generated code that is a template for the *user's* project, not a leak. */
const EXAMPLE_FILES = /\.env\.example$|README|\.md$/;

/**
 * Reduces a secret to its shape.
 *
 * Keeps enough to recognise which credential is meant — a prefix and a
 * length — and discards everything that would let a reader use it. Never
 * returns more than four leading characters of the value itself.
 */
export function redact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '****';
  return `${trimmed.slice(0, 4)}…${'*'.repeat(6)} (${String(trimmed.length)} chars)`;
}

/** One line of a file, for evidence. Trimmed and length-capped. */
function evidenceLine(file: SourceFile, index: number, redacted?: string): string {
  const raw = file.content.split('\n')[index] ?? '';
  const line = redacted ?? raw.trim();
  const capped = line.length > 160 ? `${line.slice(0, 157)}…` : line;
  return `${file.path}:${String(index + 1)} — ${capped}`;
}

function lineIndexOf(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length - 1;
}

/* ── Secrets ───────────────────────────────────────────────────────────── */

/**
 * Assignments that look like a credential with a literal value.
 *
 * The value pattern requires length and entropy-ish variety: a bare
 * `password = ''` or `apiKey = process.env.X` is not a leak, and reporting
 * either would train a reader to ignore this check.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: 'provider API key',
    pattern: /\b(?:gsk|sk|pk|rk)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    name: 'assigned credential',
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key)\b\s*[:=]\s*['"`]([^'"`\s]{12,})['"`]/gi,
  },
  {
    name: 'connection string with credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s'"]+:([^@\s'"]{4,})@/gi,
  },
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
];

/** Values that look like secrets but are placeholders the generator emits. */
const PLACEHOLDER =
  /^(?:change[_-]?me|your[_-]|replace[_-]|example|placeholder|xxx+|\.\.\.|<[^>]*>)/i;

function scanSecrets(files: readonly SourceFile[]): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const file of files) {
    if (EXAMPLE_FILES.test(file.path)) continue;

    for (const { name, pattern } of SECRET_PATTERNS) {
      for (const match of file.content.matchAll(pattern)) {
        const value = match[1] ?? match[0];
        if (PLACEHOLDER.test(value)) continue;
        if (/process\.env|import\.meta\.env/.test(match[0])) continue;

        const index = lineIndexOf(file.content, match.index);
        findings.push({
          type: 'SECURITY',
          severity: 'CRITICAL',
          category: 'SECRETS',
          title: `Hard-coded ${name} in source`,
          description: `A literal credential appears in ${file.path}. Anything committed here is readable by everyone with repository access and cannot be rotated without a code change.`,
          // The value never appears — only its shape.
          evidence: evidenceLine(file, index, `${name} = ${redact(value)}`),
          recommendation:
            'Read the value from an environment variable and keep the real value out of version control. Treat this credential as compromised and rotate it.',
          targetNodeId: null,
          targetFile: file.path,
          confidence: 0.95,
          status: 'OPEN',
        });
      }
    }
  }

  return findings;
}

/* ── Dangerous execution ───────────────────────────────────────────────── */

const EXECUTION_CHECKS: {
  category: string;
  pattern: RegExp;
  severity: AgentFinding['severity'];
  title: string;
  description: string;
  recommendation: string;
}[] = [
  {
    category: 'INJECTION',
    pattern: /\beval\s*\(/g,
    severity: 'HIGH',
    title: 'Dynamic evaluation of code',
    description:
      'eval() executes whatever string it is given. If any part of that string can be influenced by a request, this is remote code execution.',
    recommendation: 'Replace eval with an explicit parser or a lookup over known values.',
  },
  {
    category: 'INJECTION',
    pattern: /\b(?:exec|execSync)\s*\(\s*[`'"][^`'"]*\$\{/g,
    severity: 'CRITICAL',
    title: 'Shell command built from an interpolated string',
    description:
      'A command assembled by string interpolation lets any shell metacharacter in the interpolated value change what runs.',
    recommendation:
      'Use execFile/spawn with an argument array so the value can never be read as shell syntax.',
  },
  {
    category: 'INJECTION',
    pattern: /\$queryRawUnsafe\s*\(|\$executeRawUnsafe\s*\(/g,
    severity: 'HIGH',
    title: 'Raw SQL executed through an unsafe helper',
    description:
      'The `Unsafe` variants interpolate directly into SQL. A value reaching one of these from a request is SQL injection.',
    recommendation:
      'Use $queryRaw with a tagged template, or the typed query builder, so values are parameterized.',
  },
  {
    category: 'INJECTION',
    pattern: /\b(?:query|execute)\s*\(\s*[`'"][^`'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^`'"]*\$\{/gi,
    severity: 'HIGH',
    title: 'SQL assembled by string interpolation',
    description:
      'The statement is built by concatenating a value into SQL text rather than binding it as a parameter.',
    recommendation: 'Bind values as parameters instead of interpolating them into the statement.',
  },
  {
    category: 'OUTPUT_HANDLING',
    pattern: /dangerouslySetInnerHTML/g,
    severity: 'MEDIUM',
    title: 'Raw HTML injected into the DOM',
    description:
      'dangerouslySetInnerHTML bypasses React’s escaping. If the value can carry user content, this is stored XSS.',
    recommendation: 'Render the value as text, or sanitize it before injecting it.',
  },
];

function scanExecution(files: readonly SourceFile[]): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const file of files) {
    if (EXAMPLE_FILES.test(file.path)) continue;

    for (const check of EXECUTION_CHECKS) {
      for (const match of file.content.matchAll(check.pattern)) {
        const index = lineIndexOf(file.content, match.index);
        findings.push({
          type: 'SECURITY',
          severity: check.severity,
          category: check.category,
          title: check.title,
          description: `${check.description} Found in ${file.path}.`,
          evidence: evidenceLine(file, index),
          recommendation: check.recommendation,
          targetNodeId: null,
          targetFile: file.path,
          // The construct is certainly present; whether it is reachable
          // from a request is not something this check can see.
          confidence: 0.8,
          status: 'OPEN',
        });
      }
    }
  }

  return findings;
}

/* ── Configuration ─────────────────────────────────────────────────────── */

function scanConfiguration(files: readonly SourceFile[]): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const file of files) {
    if (EXAMPLE_FILES.test(file.path)) continue;

    // CORS with a wildcard origin *and* credentials is the combination
    // that actually matters; a wildcard alone on a public API is a choice.
    const corsWildcard = /origin\s*:\s*['"`]\*['"`]/.exec(file.content);
    if (corsWildcard) {
      const withCredentials = /credentials\s*:\s*true/.test(file.content);
      const index = lineIndexOf(file.content, corsWildcard.index);
      findings.push({
        type: 'SECURITY',
        severity: withCredentials ? 'HIGH' : 'MEDIUM',
        category: 'CONFIGURATION',
        title: withCredentials
          ? 'CORS allows any origin with credentials'
          : 'CORS allows any origin',
        description: withCredentials
          ? 'A wildcard origin combined with credentials lets any site issue authenticated requests on a signed-in user’s behalf.'
          : `Any site can call this API from a browser. In ${file.path}.`,
        evidence: evidenceLine(file, index),
        recommendation: 'Restrict the origin to the domains that are meant to call this API.',
        targetNodeId: null,
        targetFile: file.path,
        confidence: 0.9,
        status: 'OPEN',
      });
    }

    const debugOn =
      !/\bNODE_ENV\s*[!=]==?\s*['"`]production['"`]/.test(file.content) &&
      /\b(?:debug|DEBUG)\s*[:=]\s*true\b/.exec(file.content);
    if (debugOn) {
      const index = lineIndexOf(file.content, debugOn.index);
      findings.push({
        type: 'SECURITY',
        severity: 'MEDIUM',
        category: 'CONFIGURATION',
        title: 'Debug mode enabled unconditionally',
        description: `Debug output is switched on without checking the environment, in ${file.path}. Debug responses routinely include stack traces and internal paths.`,
        evidence: evidenceLine(file, index),
        recommendation: 'Gate debug behaviour on NODE_ENV rather than a constant.',
        targetNodeId: null,
        targetFile: file.path,
        confidence: 0.7,
        status: 'OPEN',
      });
    }

    // A stack trace on the wire tells an attacker the framework, the file
    // layout and often the query that failed.
    const stackLeak = /res\s*\.\s*(?:json|send)\s*\(\s*\{[^}]*\bstack\b/.exec(file.content);
    if (stackLeak) {
      const index = lineIndexOf(file.content, stackLeak.index);
      findings.push({
        type: 'SECURITY',
        severity: 'MEDIUM',
        category: 'API_SECURITY',
        title: 'Error response includes a stack trace',
        description: `An error handler in ${file.path} returns the stack to the client.`,
        evidence: evidenceLine(file, index),
        recommendation: 'Log the stack server-side and return a message with no internal detail.',
        targetNodeId: null,
        targetFile: file.path,
        confidence: 0.85,
        status: 'OPEN',
      });
    }
  }

  return findings;
}

/* ── Cookies ───────────────────────────────────────────────────────────── */

function scanCookies(files: readonly SourceFile[]): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const file of files) {
    const cookieCall = /res\s*\.\s*cookie\s*\(/.exec(file.content);
    if (!cookieCall) continue;

    const missing: string[] = [];
    if (!/httpOnly\s*:\s*true/.test(file.content)) missing.push('httpOnly');
    if (!/sameSite\s*:/.test(file.content)) missing.push('sameSite');
    if (!/secure\s*:/.test(file.content)) missing.push('secure');
    if (missing.length === 0) continue;

    const index = lineIndexOf(file.content, cookieCall.index);
    findings.push({
      type: 'SECURITY',
      severity: missing.includes('httpOnly') ? 'HIGH' : 'MEDIUM',
      category: 'AUTHENTICATION',
      title: `Cookie set without ${missing.join(', ')}`,
      description: `A cookie is written in ${file.path} without ${missing.join(' or ')}. Without httpOnly, any injected script can read it.`,
      evidence: evidenceLine(file, index),
      recommendation: `Set ${missing.join(', ')} on the cookie.`,
      targetNodeId: null,
      targetFile: file.path,
      confidence: 0.85,
      status: 'OPEN',
    });
  }

  return findings;
}

/* ── Route-level authorization ─────────────────────────────────────────── */

/**
 * Route registrations that mount no guard.
 *
 * The check reads *call sites*, not the file as a whole. An earlier
 * version asked whether the file referenced any auth middleware anywhere,
 * and a router that still imported `requireRoles` but applied it to
 * nothing passed — the exact case Step 32 plants. A route line either
 * names a guard among its handlers or it does not, and generated code
 * declares one route per statement, so the line is the right unit.
 *
 * A router-wide `.use(guard)` counts for every route beneath it. What this
 * still cannot see is middleware applied where the router is *mounted*, in
 * another file — which is why the confidence is 0.6 rather than 1.
 */
function scanRouteGuards(files: readonly SourceFile[], authExpected: boolean): AgentFinding[] {
  if (!authExpected) return [];

  const findings: AgentFinding[] = [];
  const guard =
    /requireAuth|authenticate|authorize|isAuthenticated|passport|verifyToken|requireRole/;
  // `router.get(` and `productsRouter.get(` both count — the generator
  // names its routers, and a scanner that only knew the bare spelling
  // missed every generated route file.
  const routeCall = /\b\w*[Rr]outer\s*\.\s*(?:get|post|put|patch|delete)\s*\(/;
  const routerUse = /\b\w*[Rr]outer\s*\.\s*use\s*\(/;

  for (const file of files) {
    if (/auth/i.test(file.path)) continue; // the auth router itself is public by design

    const lines = file.content.split('\n');
    const routeLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => routeCall.test(line));
    if (routeLines.length === 0) continue;

    // A router-wide guard covers everything registered on it.
    if (lines.some((line) => routerUse.test(line) && guard.test(line))) continue;

    const unguarded = routeLines.filter(({ line }) => !guard.test(line));
    if (unguarded.length === 0) continue;

    const first = unguarded[0];
    findings.push({
      type: 'SECURITY',
      severity: 'HIGH',
      category: 'AUTHORIZATION',
      title:
        unguarded.length === routeLines.length
          ? 'Router mounts routes with no authentication middleware'
          : 'Some routes mount no authentication middleware',
      description: `${String(unguarded.length)} of ${String(routeLines.length)} route registration(s) in ${file.path} name no authentication or authorization middleware, in a project whose requirements ask for access control.`,
      evidence: first ? evidenceLine(file, first.index) : file.path,
      recommendation:
        'Attach the project’s auth middleware to these routes, or state explicitly that they are public.',
      targetNodeId: null,
      targetFile: file.path,
      confidence: 0.6,
      status: 'OPEN',
    });
  }

  return findings;
}

export interface SourceScanInput {
  files: readonly SourceFile[];
  /** Whether the requirements call for authentication at all. */
  authExpected: boolean;
}

export function scanSource(input: SourceScanInput): AgentFinding[] {
  return [
    ...scanSecrets(input.files),
    ...scanExecution(input.files),
    ...scanConfiguration(input.files),
    ...scanCookies(input.files),
    ...scanRouteGuards(input.files, input.authExpected),
  ];
}
