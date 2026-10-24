/**
 * Materializes a generated project onto disk. The workspace root is
 * OS-tmp by default (`NEXARCH_RUNNER_DIR` overrides — an optional
 * per-deployment knob, read here once per the platform's documented
 * provider-key convention) so run artifacts never pollute the repository.
 * Path traversal is rejected before any write: file paths come from the
 * request body and are treated as untrusted.
 *
 * This module owns the runner's *only* path-containment rule — `isInside`
 * and `resolveInside`. Every write here and the one recursive delete in
 * `orphan-reaper.ts` go through it, because a containment check that is
 * written twice is a containment check that disagrees with itself.
 */
import { constants } from 'node:fs';
import { mkdir, writeFile, access, readFile, realpath, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError } from '../../../shared/utils/app-error.js';
import type { RunnerFile } from '../runner.types.js';

export function workspaceRoot(): string {
  const configured = process.env.NEXARCH_RUNNER_DIR ?? path.join(os.tmpdir(), 'nexarch-runs');
  // Resolved once, here: every containment check compares resolved paths,
  // and a relative NEXARCH_RUNNER_DIR would otherwise be compared against
  // absolute child paths — a prefix test that answers "outside" for
  // everything and so protects nothing.
  return path.resolve(configured);
}

/**
 * Whether `candidate` is `root` itself or something beneath it. Both sides
 * must already be absolute and resolved.
 *
 * The `+ path.sep` is the whole point. A bare string prefix also matches a
 * sibling whose name merely starts with the root's — `/runs/app-1` would
 * authorize `/runs/app-12` — which is how a prefix check ends up blessing a
 * directory it was never meant to.
 */
export function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Resolves an untrusted relative path against a directory and proves the
 * result stays inside it, or rejects the request.
 *
 * `path.resolve` collapses `..` before the comparison, so `a/../../b`,
 * `./../x` and `/etc/passwd` all fail the same test — there is no separator
 * or dot-segment trick to find here, because the comparison happens after
 * normalization rather than on the text that was sent. Absolute paths are
 * refused outright even when they happen to land inside the workspace: file
 * paths in a generated project are relative, and anything else is a sign
 * the file set is not what we think it is. The explicit NUL check exists so
 * an embedded NUL comes back as a 400 naming the file instead of a bare
 * ERR_INVALID_ARG_VALUE from the fs layer.
 */
export function resolveInside(dir: string, relativePath: string): string {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw AppError.badRequest(`Unsafe file path in project files: ${relativePath}`);
  }
  const root = path.resolve(dir);
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target)) {
    throw AppError.badRequest(`File path escapes the project workspace: ${relativePath}`);
  }
  return target;
}

/**
 * Open-for-writing without following a symlink at the final component.
 * `O_NOFOLLOW` does not exist on Windows, where the 0 leaves an ordinary
 * truncating write.
 */
const WRITE_FLAGS =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_TRUNC |
  (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/**
 * The only way bytes reach a run workspace.
 *
 * `resolveInside` settles the path as text; this settles it on disk, and
 * both are needed, because text cannot see a symlink. `mkdir -p` walks
 * straight *through* one, so a link at `backend/node_modules` pointing at
 * the developer's home directory turns `backend/node_modules/x` — a path
 * that passes every `..` and prefix test — into a write outside the
 * workspace. Comparing the real parent directory against the real root
 * closes that, and `O_NOFOLLOW` closes the matching hole one level down:
 * a generated project's `postinstall` runs before the configure stage, so
 * it can replace `backend/.env` with a link to any file the developer owns
 * and have the runner truncate it. Nothing in a file set can create a link
 * itself (`writeFile` never does), but npm's own install and anything that
 * later re-writes files into an installed workspace can.
 */
async function writeContained(dir: string, relativePath: string, content: string): Promise<void> {
  const target = resolveInside(dir, relativePath);
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });

  const realRoot = await realpath(dir);
  await assertNoSymlinkComponents(dir, realRoot, parent, relativePath);

  try {
    await writeFile(target, content, { encoding: 'utf8', flag: WRITE_FLAGS });
  } catch (error) {
    // ELOOP here is O_NOFOLLOW refusing a symlink at the file name itself.
    if (errorCode(error) === 'ELOOP') {
      throw AppError.badRequest(`File path is a symlink and was not followed: ${relativePath}`);
    }
    throw error;
  }

  // Checked again, after the fact, because the check above and the write are
  // two syscalls and this directory is writable by processes the platform
  // started. A concurrent swap of a parent component for a symlink was
  // demonstrated to land files outside the root *and have this function
  // return success*. Node exposes no `openat`, so the window cannot be closed
  // from here; what it can do is refuse to call an escape a success, and take
  // the escaped content back out.
  const written = await realpath(target).catch(() => null);
  if (written === null || !isInside(realRoot, written)) {
    await rm(target, { force: true }).catch(() => undefined);
    throw AppError.badRequest(
      `File path escaped the project workspace while being written: ${relativePath}`,
    );
  }
}

/**
 * Refuse a path whose parent chain contains a symlink.
 *
 * `realpath` on the parent answers "where does this resolve to", which a
 * symlink satisfies happily as long as its target is inside the root at that
 * instant. Walking the chain and rejecting symlinks outright is a stricter
 * rule, and the runner has no legitimate need for one: it creates every
 * directory under this root itself.
 */
async function assertNoSymlinkComponents(
  dir: string,
  realRoot: string,
  parent: string,
  relativePath: string,
): Promise<void> {
  // Measured from the same unresolved base the target was built from: on
  // macOS the workspace lives under /var, whose realpath is /private/var, and
  // comparing one against the other calls every legitimate write an escape.
  const relative = path.relative(path.resolve(dir), path.resolve(parent));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw AppError.badRequest(`File path escapes the project workspace: ${relativePath}`);
  }

  let current = realRoot;
  for (const segment of relative.split(path.sep).filter((part) => part !== '')) {
    current = path.join(current, segment);
    const stats = await lstat(current).catch(() => null);
    if (stats === null) continue; // not created yet by this write
    if (stats.isSymbolicLink()) {
      throw AppError.badRequest(
        `File path passes through a symlinked directory and was refused: ${relativePath}`,
      );
    }
  }
}

export async function writeWorkspace(
  sessionId: string,
  projectSlug: string,
  files: readonly RunnerFile[],
): Promise<string> {
  const dir = path.join(workspaceRoot(), `${projectSlug}-${sessionId.slice(0, 8)}`);
  await mkdir(dir, { recursive: true });

  for (const file of files) {
    await writeContained(dir, file.path, file.content);
  }
  return dir;
}

/**
 * Ensure a .env exists, derived from the project's own .env.example with
 * runner-controlled overrides (ports) applied. An existing .env is kept —
 * the user may have pointed it at a real database between runs.
 *
 * Both paths come from the plan rather than the request today, but they go
 * through the same containment rule as the file set: this runs *after*
 * `npm install`, so it is the one write that happens in a directory a
 * generated project's lifecycle scripts have already had a chance to
 * reshape.
 */
export async function ensureEnvFile(
  workspaceDir: string,
  envPath: string,
  examplePath: string,
  overrides: Record<string, string>,
): Promise<void> {
  const target = resolveInside(workspaceDir, envPath);
  try {
    await access(target);
    return; // keep the user's edits
  } catch {
    // fall through and create it
  }

  let content = '';
  try {
    content = await readFile(resolveInside(workspaceDir, examplePath), 'utf8');
  } catch {
    // no example — synthesize from overrides alone
  }

  const lines = content.split('\n');
  const seen = new Set<string>();
  const rewritten = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line.trim());
    if (match?.[1] && overrides[match[1]] !== undefined) {
      seen.add(match[1]);
      return `${match[1]}=${overrides[match[1]]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) rewritten.push(`${key}=${value}`);
  }

  await writeContained(workspaceDir, envPath, rewritten.join('\n'));
}
