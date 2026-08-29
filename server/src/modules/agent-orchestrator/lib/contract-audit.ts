/**
 * Does the frontend call endpoints the contract declares?
 *
 * Shared by the frontend engineer (at generation time), the repair
 * validator (after a patch) and the repair strategies (to find the nearest
 * declared path) — one audit, three consumers, so a fix to the analysis
 * fixes all of them.
 *
 * This replaced an earlier per-agent version that only read string-literal
 * call arguments in `src/shared/api/` files. The generated services do not
 * look like that: they declare `const BASE_PATH = '/products'` and call
 * `apiClient.get(\`${BASE_PATH}/${id}\`)`, so the old audit resolved
 * nothing and vacuously passed. This one resolves the constant per file
 * and substitutes it before comparing — it audits the code the generator
 * actually writes.
 */
import type { OpenApiDocument } from '../../../shared/types/design.js';

export interface AuditFile {
  path: string;
  content: string;
}

export interface EmittedCall {
  file: string;
  method: string;
  /** The argument as written: `${BASE_PATH}/${id}`, `/orders`, … */
  raw: string;
  /** With constants substituted and params folded: `/orders/:param`. */
  resolved: string;
}

/** `/products/{id}` · `/products/${id}` · `/products/:id` → `/products/:param`. */
export function normalizeApiPath(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/\{[^}]*\}/g, ':param')
    .replace(/\/:[A-Za-z_][A-Za-z0-9_]*/g, '/:param')
    .replace(/\/+$/, '')
    .replace(/^\/api\/v\d+/, '');
}

export function declaredOperations(api: OpenApiDocument): Set<string> {
  const declared = new Set<string>();
  for (const [path, item] of Object.entries(api.paths)) {
    for (const method of Object.keys(item)) {
      declared.add(`${method.toUpperCase()} ${normalizeApiPath(path)}`);
    }
  }
  return declared;
}

/** Files that speak HTTP: the shared client layer and per-feature services. */
function isApiFile(path: string): boolean {
  return (
    path.startsWith('src/shared/api/') ||
    path.includes('.api.') ||
    /\/services\/[^/]+\.service\.ts$/.test(path)
  );
}

const CALL_PATTERN =
  /\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*(`[^`]+`|'[^']+'|"[^"]+"|[A-Z_][A-Z0-9_]*)/g;

/**
 * Every HTTP call the frontend source makes, with per-file constants
 * resolved. A call whose argument cannot be resolved to a path is skipped
 * rather than guessed — an audit that guesses invents mismatches.
 */
export function emittedCalls(files: readonly AuditFile[]): EmittedCall[] {
  const calls: EmittedCall[] = [];

  for (const file of files) {
    if (!isApiFile(file.path)) continue;

    // Path-valued constants declared in this file: BASE_PATH and friends.
    const constants = new Map<string, string>();
    for (const match of file.content.matchAll(
      /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"`](\/[^'"`]*)['"`]/g,
    )) {
      const name = match[1];
      const value = match[2];
      if (name && value) constants.set(name, value);
    }

    for (const match of file.content.matchAll(CALL_PATTERN)) {
      const method = match[1]?.toUpperCase() ?? '';
      let raw = match[2] ?? '';

      if (/^[A-Z_][A-Z0-9_]*$/.test(raw)) {
        const value = constants.get(raw);
        if (!value) continue;
        raw = value;
      } else {
        raw = raw.slice(1, -1); // strip the quote/backtick pair
        for (const [name, value] of constants) {
          raw = raw.replaceAll(`\${${name}}`, value);
        }
      }

      if (!raw.startsWith('/') && !raw.startsWith('${')) continue;
      calls.push({ file: file.path, method, raw, resolved: normalizeApiPath(raw) });
    }
  }
  return calls;
}

export interface ContractAudit {
  calls: EmittedCall[];
  /** Calls with no matching declared operation — each one a 404 in waiting. */
  undeclared: EmittedCall[];
}

export function auditFrontendContract(
  files: readonly AuditFile[],
  api: OpenApiDocument,
): ContractAudit {
  const declared = declaredOperations(api);
  const calls = emittedCalls(files);
  return {
    calls,
    undeclared: calls.filter((call) => !declared.has(`${call.method} ${call.resolved}`)),
  };
}

/**
 * The declared path closest to a wrong one, for the same method.
 *
 * "Closest" is token overlap over path segments — deliberately simple,
 * because the repair engine only acts on it when exactly one candidate is
 * clearly closest. A tie means ambiguity, and ambiguity means no
 * automatic repair.
 */
export function nearestDeclaredPath(
  api: OpenApiDocument,
  method: string,
  wrongPath: string,
): string | null {
  const wanted = normalizeApiPath(wrongPath);
  const wrongTokens = new Set(wanted.split('/').filter((part) => part && part !== ':param'));

  let best: { path: string; score: number } | null = null;
  let tie = false;

  for (const [path, item] of Object.entries(api.paths)) {
    if (!(method.toLowerCase() in item)) continue;
    const normalized = normalizeApiPath(path);
    // Parameter arity must match: `/orders` is not a candidate for `/orders/:id`.
    if ((normalized.match(/:param/g) ?? []).length !== (wanted.match(/:param/g) ?? []).length) {
      continue;
    }
    const tokens = normalized.split('/').filter((part) => part && part !== ':param');
    const overlap = tokens.filter((token) =>
      [...wrongTokens].some(
        (wrong) => token.includes(wrong) || wrong.includes(token) || similar(token, wrong),
      ),
    ).length;
    const score = overlap * 2 - Math.abs(tokens.length - wrongTokens.size);

    if (!best || score > best.score) {
      best = { path, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }

  if (!best || tie || best.score <= 0) return null;
  return best.path;
}

/** Same first four letters — catches `product-items` vs `products`. */
function similar(a: string, b: string): boolean {
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4);
}
