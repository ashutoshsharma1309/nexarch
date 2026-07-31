/**
 * Materializes a generated project onto disk. The workspace root is
 * OS-tmp by default (`NEXARCH_RUNNER_DIR` overrides — an optional
 * per-deployment knob, read here once per the platform's documented
 * provider-key convention) so run artifacts never pollute the repository.
 * Path traversal is rejected before any write: file paths come from the
 * request body and are treated as untrusted.
 */
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError } from '../../../shared/utils/app-error.js';
import type { RunnerFile } from '../runner.types.js';

export function workspaceRoot(): string {
  return process.env.NEXARCH_RUNNER_DIR ?? path.join(os.tmpdir(), 'nexarch-runs');
}

function assertSafeRelativePath(filePath: string): void {
  const normalized = path.normalize(filePath);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw AppError.badRequest(`Unsafe file path in project files: ${filePath}`);
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
    assertSafeRelativePath(file.path);
    const target = path.join(dir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
  return dir;
}

/**
 * Ensure a .env exists, derived from the project's own .env.example with
 * runner-controlled overrides (ports) applied. An existing .env is kept —
 * the user may have pointed it at a real database between runs.
 */
export async function ensureEnvFile(
  workspaceDir: string,
  envPath: string,
  examplePath: string,
  overrides: Record<string, string>,
): Promise<void> {
  const target = path.join(workspaceDir, envPath);
  try {
    await access(target);
    return; // keep the user's edits
  } catch {
    // fall through and create it
  }

  let content = '';
  try {
    content = await readFile(path.join(workspaceDir, examplePath), 'utf8');
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

  await writeFile(target, rewritten.join('\n'), 'utf8');
}
