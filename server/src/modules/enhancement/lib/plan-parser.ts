/**
 * Turns a model's plan into one this project can actually carry out.
 *
 * Model output is a proposal. Each path is checked against the real file list
 * and against a list of places an enhancement must never write, so that "only
 * touch planned files" means something: the plan itself cannot name a path
 * outside the project or overwrite a real secrets file.
 */
import type {
  AuthFlowSpec,
  CrudFlowSpec,
  EnvChange,
  FunctionalCheckSpec,
  PlannedFile,
  PlannedFileAction,
} from '../enhancement.types.js';

export const MAX_PLANNED_FILES = 30;

/** Writable top-level areas of a generated project. */
const ALLOWED_ROOTS = ['backend/', 'frontend/', 'tests/', 'docs/'];
const ALLOWED_ROOT_FILES = new Set(['README.md', '.env.example', 'docker-compose.yml']);

const FORBIDDEN =
  /(^|\/)(node_modules|\.git)\/|^((backend|frontend)\/)?(dist|build|\.next|coverage)\/|(^|\/)\.env(\.(?!example$)[^/]*)?$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|exe|dll|so|dylib|woff2?|ttf|eot|mp4|mp3)$/i;

/** The reason a path may not be written, or null when it may. */
export function unsafePathReason(path: string): string | null {
  if (path === '' || path.length > 240) return 'not a usable path';
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) {
    return 'must be relative to the project root';
  }
  if (path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    return 'must not contain relative segments';
  }
  if (FORBIDDEN.test(path)) return 'is a generated, binary, lock or secrets file';
  if (!ALLOWED_ROOT_FILES.has(path) && !ALLOWED_ROOTS.some((root) => path.startsWith(root))) {
    return `must be inside ${ALLOWED_ROOTS.join(', ')}`;
  }
  return null;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function strings(value: unknown, maxItems: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => str(item, itemMax))
    .filter((item) => item !== '')
    .slice(0, maxItems);
}

export interface ParsedPlan {
  summary: string;
  steps: string[];
  files: PlannedFile[];
  risks: string[];
  envChanges: EnvChange[];
  functionalChecks: FunctionalCheckSpec[];
  /** Files the model named that were refused, with why. */
  rejected: string[];
}

function parseFiles(
  raw: unknown,
  existing: ReadonlySet<string>,
): { files: PlannedFile[]; rejected: string[] } {
  const rejected: string[] = [];
  const seen = new Set<string>();
  const files: PlannedFile[] = [];
  for (const item of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    const path = str(item.path, 260);
    if (path === '' || seen.has(path)) continue;
    const unsafe = unsafePathReason(path);
    if (unsafe !== null) {
      rejected.push(`${path}: ${unsafe}`);
      continue;
    }
    const exists = existing.has(path);
    const wanted = str(item.action, 16);
    let action: PlannedFileAction;
    if (wanted === 'delete') {
      if (!exists) {
        rejected.push(`${path}: planned for deletion but does not exist`);
        continue;
      }
      action = 'delete';
    } else {
      // "Modify" on a file that does not exist is a create; trust the list.
      action = exists ? 'modify' : 'create';
    }
    seen.add(path);
    files.push({ path, action, reason: str(item.reason, 300) || 'Named by the plan' });
    if (files.length >= MAX_PLANNED_FILES) {
      rejected.push(`Stopped at ${String(MAX_PLANNED_FILES)} files; the rest were not planned.`);
      break;
    }
  }
  return { files, rejected };
}

/** A path on the app under test. `//host` would leave it. */
function isLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

function endpoint(raw: unknown): { method: string; path: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const method = str(entry.method, 8).toUpperCase();
  const path = str(entry.path, 200);
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method) || !isLocalPath(path)) return null;
  return { method, path };
}

function parseAuth(raw: Record<string, unknown>): AuthFlowSpec | null {
  const register = endpoint(raw.register);
  const login = endpoint(raw.login);
  const logout = endpoint(raw.logout);
  const guarded = endpoint(raw.protected);
  if (!register || !login || !logout || !guarded) return null;
  const extras = (raw.extraRegisterFields ?? {}) as Record<string, unknown>;
  return {
    kind: 'auth',
    register,
    login,
    logout,
    protected: guarded,
    emailField: str(raw.emailField, 40) || 'email',
    passwordField: str(raw.passwordField, 40) || 'password',
    extraRegisterFields: Object.fromEntries(
      Object.entries(extras)
        .slice(0, 10)
        .map(([key, value]) => [key, String(value).slice(0, 80)]),
    ),
  };
}

function parseCrud(raw: Record<string, unknown>): CrudFlowSpec | null {
  const collectionPath = str(raw.collectionPath, 200);
  if (!isLocalPath(collectionPath)) return null;
  const objectOf = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const createBody = objectOf(raw.createBody);
  const updateBody = objectOf(raw.updateBody);
  if (!createBody || !updateBody) return null;
  const auth = objectOf(raw.auth);
  const parsedAuth = auth ? parseAuth(auth) : null;
  return {
    ...(parsedAuth ? { auth: parsedAuth } : {}),
    kind: 'crud',
    resource: str(raw.resource, 60) || 'record',
    collectionPath,
    createBody,
    updateBody,
    idField: str(raw.idField, 40) || 'id',
  };
}

function parseChecks(raw: unknown): FunctionalCheckSpec[] {
  const checks: FunctionalCheckSpec[] = [];
  for (const item of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    const parsed =
      item.kind === 'auth' ? parseAuth(item) : item.kind === 'crud' ? parseCrud(item) : null;
    if (parsed) checks.push(parsed);
    if (checks.length >= 3) break;
  }
  return checks;
}

function parseEnv(raw: unknown): EnvChange[] {
  const changes: EnvChange[] = [];
  for (const item of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    const name = str(item.name, 64);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    changes.push({
      name,
      purpose: str(item.purpose, 200),
      example: str(item.example, 100) || 'replace-me',
    });
  }
  return changes.slice(0, 20);
}

export function parsePlan(raw: unknown, existingPaths: ReadonlySet<string>): ParsedPlan {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const { files, rejected } = parseFiles(body.files, existingPaths);
  return {
    summary: str(body.summary, 600),
    steps: strings(body.steps, 20, 300),
    files,
    risks: strings(body.risks, 12, 300),
    envChanges: parseEnv(body.envChanges),
    functionalChecks: parseChecks(body.functionalChecks),
    rejected,
  };
}

/** Parses a model's JSON answer, tolerating the code fences models add anyway. */
export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}
