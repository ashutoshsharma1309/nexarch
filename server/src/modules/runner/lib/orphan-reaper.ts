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
import {
  mkdirSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { logger } from '../../../shared/logger/index.js';
import { isInside, workspaceRoot } from './workspace-writer.js';

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
/**
 * The working directory a live process is actually in.
 *
 * This replaces an ownership check that could never pass: it compared the
 * note's `cwd` against `ps -o command=`, which prints the argv. The runner
 * spawns `npm run dev`, whose argv never contains a path, so the gate was
 * unsatisfiable for every process this module exists to reap — nothing was
 * ever reaped, and the note was deleted anyway, which then hid a *live*
 * workspace from the pruner that reads those notes to know what is in use.
 *
 * `lsof` on macOS and `/proc` on Linux both answer the question the check was
 * always trying to ask. A pid whose cwd cannot be read is left alone.
 */
function processCwd(pid: number): string | null {
  if (process.platform === 'win32') return null;

  if (process.platform === 'linux') {
    try {
      return realpathSync(`/proc/${String(pid)}/cwd`);
    } catch {
      return null;
    }
  }

  const result = spawnSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout) return null;
  // `-Fn` prints one field per line; the cwd is the line beginning with `n`.
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('n'));
  return line === undefined ? null : line.slice(1).trim();
}

/** Two paths that resolve to the same place, symlinks and all. */
function samePath(a: string, b: string): boolean {
  const resolve = (value: string): string => {
    try {
      return realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return resolve(a) === resolve(b);
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

    // A note only speaks for a process the runner started, and the runner
    // only ever runs things from inside the run root. The notes directory
    // sits in that root, writable by every generated app this platform
    // starts (same uid, same tmp root) — so without this check a project
    // could drop in a note and have the next boot SIGKILL any pid of the
    // developer's whose command line it could guess.
    if (!isInside(workspaceRoot(), path.resolve(note.cwd))) {
      logger.warn('ignoring a runner process note that points outside the run root', {
        pid: note.pid,
        cwd: note.cwd,
      });
      rmSync(file, { force: true });
      continue;
    }

    // Pid reuse is real. Only kill a process that is still sitting in the
    // directory we wrote down; if its cwd cannot be read, leave it running
    // AND leave the note, because the note is what tells the pruner this
    // workspace is in use. Deleting it here is how a live app's node_modules
    // used to get deleted out from under it moments later.
    const cwd = processCwd(note.pid);
    if (cwd === null || !samePath(cwd, note.cwd)) {
      logger.warn('leaving a recorded runner process alone — it is no longer ours', {
        pid: note.pid,
        cwd: note.cwd,
        observed: cwd,
      });
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
        if (isAlive(note.pid)) inUse.add(path.resolve(note.cwd));
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
      // lstat, not stat: a symlink that merely points at a directory is not
      // a workspace this platform wrote, and following one would aim a
      // recursive delete at whatever it names.
      const stats = lstatSync(dir);
      if (!stats.isDirectory()) continue;
      // Path-boundary containment, not a raw string prefix: `…/app-1` must
      // not be read as protecting — or being protected by — `…/app-12`.
      if ([...inUse].some((cwd) => isInside(dir, cwd))) continue;
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
    // The only recursive delete in the runner, so prove the target before
    // running it: strictly inside the resolved run root, on the resolved
    // path rather than the string that was listed. `entries` are names from
    // readdir and cannot contain a separator today — the assertion is what
    // keeps that true if someone later passes a path in from elsewhere.
    const resolved = path.resolve(workspace.dir);
    if (resolved === root || !isInside(root, resolved)) {
      logger.warn('refusing to prune a path outside the run workspace root', { dir: resolved });
      continue;
    }
    try {
      bytes += directorySize(resolved);
      rmSync(resolved, { recursive: true, force: true });
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
      // lstat so symlinks count as themselves and are never walked into.
      // node_modules is full of them, and a link that points back up its
      // own tree (what npm workspaces and local `file:` deps produce) makes
      // a following walk recurse until the stack goes — which the caller
      // catches, so pruning would silently stop happening.
      const stats = lstatSync(child);
      total += stats.isDirectory() ? directorySize(child) : stats.size;
    } catch {
      // Skip what cannot be read.
    }
  }
  return total;
}
