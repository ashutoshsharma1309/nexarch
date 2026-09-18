/**
 * Cleaning up dev servers that outlived the NexArch process which started them.
 *
 * The supervisor sweeps its children on `exit` and on SIGTERM/SIGINT/SIGHUP,
 * which covers every shutdown the platform is told about. It cannot cover
 * SIGKILL — `kill -9`, an OOM kill, a crashed container — because nothing
 * runs after it. That gap is not theoretical: four generated projects were
 * found still holding ports 5175-5179, owned by NexArch processes that no
 * longer existed, with no session record anywhere that could stop them.
 *
 * So every long-running child writes down where it is before it starts, and
 * a fresh NexArch reads those notes on boot and finishes the job the killed
 * one could not. A note is only acted on when the pid is still alive AND the
 * live process's command line still points into the workspace we recorded —
 * pids are recycled, and killing a stranger's process is far worse than
 * leaving a port bound.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { logger } from '../../../shared/logger/index.js';
import { workspaceRoot } from './workspace-writer.js';

interface ChildNote {
  pid: number;
  cwd: string;
  command: string;
  startedAt: string;
}

function notesDir(): string {
  return path.join(workspaceRoot(), '.live-processes');
}

function noteFile(pid: number): string {
  return path.join(notesDir(), `${String(pid)}.json`);
}

/** Records a long-running child so a killed NexArch can still be cleaned up after. */
export function noteChild(pid: number, cwd: string, command: string): void {
  try {
    mkdirSync(notesDir(), { recursive: true });
    const note: ChildNote = { pid, cwd, command, startedAt: new Date().toISOString() };
    writeFileSync(noteFile(pid), JSON.stringify(note), 'utf8');
  } catch (error) {
    // Bookkeeping must never break a run — the in-process sweep still applies.
    logger.debug('could not record runner child', { pid, error });
  }
}

export function forgetChild(pid: number): void {
  try {
    rmSync(noteFile(pid), { force: true });
  } catch {
    // Nothing to forget.
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The live process's own command line, or null if it cannot be read.
 *
 * Returning null means "cannot prove this is ours", and the caller must then
 * leave the process alone.
 */
function commandLineOf(pid: number): string | null {
  if (process.platform === 'win32') return null;
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.trim();
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Kills dev servers left behind by a previous NexArch process.
 *
 * Runs once at startup, before anything can allocate a port — a leftover
 * process holding 5175 is exactly what makes the next run pick a stranger
 * port or fail to bind at all. Returns how many were reaped so the caller
 * can say so out loud rather than cleaning up silently.
 */
export function reapOrphanedRunnerProcesses(): number {
  let entries: string[];
  try {
    entries = readdirSync(notesDir());
  } catch {
    return 0; // No notes directory yet — nothing has ever run here.
  }

  let reaped = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(notesDir(), entry);

    let note: ChildNote;
    try {
      note = JSON.parse(readFileSync(file, 'utf8')) as ChildNote;
    } catch {
      rmSync(file, { force: true });
      continue;
    }

    if (!isAlive(note.pid)) {
      rmSync(file, { force: true });
      continue;
    }

    // Pid reuse is real. Only kill a process that still looks like the one
    // we wrote down; if we cannot read its command line, leave it be.
    const commandLine = commandLineOf(note.pid);
    if (!commandLine?.includes(note.cwd)) {
      logger.warn('leaving a recorded runner process alone — it is no longer ours', {
        pid: note.pid,
        cwd: note.cwd,
      });
      rmSync(file, { force: true });
      continue;
    }

    logger.info('reaping orphaned runner process from a previous NexArch', {
      pid: note.pid,
      command: note.command,
      startedAt: note.startedAt,
    });
    killGroup(note.pid, 'SIGTERM');
    const timer = setTimeout(() => {
      if (isAlive(note.pid)) killGroup(note.pid, 'SIGKILL');
    }, 3_000);
    timer.unref();
    rmSync(file, { force: true });
    reaped += 1;
  }

  return reaped;
}

/**
 * How many finished run workspaces to keep on disk.
 *
 * A workspace is a full copy of a generated project *plus* its installed
 * node_modules — roughly half a gigabyte each, and a new one is created for
 * every run. Nothing ever removed them, so a few afternoons of demos left
 * 9.2 GB across seventeen directories on a disk that was 94% full, and the
 * next run's `npm install` timed out because of it. They are pure scratch:
 * each is written from artifacts at the start of the run that uses it.
 *
 * A few are kept rather than none because `restartSession` reuses an
 * installed workspace, and because the last run's files are the first thing
 * anyone looks at when a run misbehaves.
 */
const WORKSPACES_KEPT = 3;

/**
 * Removes old run workspaces, newest kept, never one that is still in use.
 *
 * Called at startup, where "in use" is knowable: this process owns no
 * sessions yet, and any directory a live process is running from belongs to
 * someone else. Returns the number of bytes freed so the caller can say so.
 */
export function pruneRunWorkspaces(): { removed: number; bytes: number } {
  const root = workspaceRoot();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return { removed: 0, bytes: 0 };
  }

  // Directories a recorded, still-living process is running from are off
  // limits — another NexArch may be using them.
  const inUse = new Set<string>();
  try {
    for (const entry of readdirSync(notesDir())) {
      if (!entry.endsWith('.json')) continue;
      try {
        const note = JSON.parse(readFileSync(path.join(notesDir(), entry), 'utf8')) as ChildNote;
        if (isAlive(note.pid)) inUse.add(note.cwd);
      } catch {
        // An unreadable note protects nothing.
      }
    }
  } catch {
    // No notes directory: nothing is recorded as running.
  }

  const workspaces: { dir: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue; // .live-processes and friends
    const dir = path.join(root, entry);
    try {
      const stats = statSync(dir);
      if (!stats.isDirectory()) continue;
      if ([...inUse].some((cwd) => cwd.startsWith(dir))) continue;
      workspaces.push({ dir, mtimeMs: stats.mtimeMs });
    } catch {
      // Vanished between listing and stat — nothing to do.
    }
  }

  workspaces.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = workspaces.slice(WORKSPACES_KEPT);

  let bytes = 0;
  let removed = 0;
  for (const workspace of stale) {
    try {
      bytes += directorySize(workspace.dir);
      rmSync(workspace.dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      logger.debug('could not remove a stale run workspace', { dir: workspace.dir, error });
    }
  }
  return { removed, bytes };
}

/** Best-effort size of a directory tree; an unreadable branch counts as zero. */
function directorySize(dir: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry);
    try {
      const stats = statSync(child);
      total += stats.isDirectory() ? directorySize(child) : stats.size;
    } catch {
      // Skip what cannot be read.
    }
  }
  return total;
}
