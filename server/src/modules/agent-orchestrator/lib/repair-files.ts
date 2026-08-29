/**
 * The only door through which a repair touches project files.
 *
 * Files live inside versioned artifacts — `backend-source`,
 * `frontend-source` and their config siblings — and this module maps an
 * area-prefixed path (`frontend/src/…`) to the artifact that holds it,
 * applies edits, and writes the result back as a *new artifact version*.
 * That reuse is the point of Step 12: the artifact store already versions
 * everything, so the "snapshot" before a repair is simply the version that
 * already exists, and rollback is writing the prior content forward as
 * another version. History is never rewritten, even to undo.
 *
 * Authorization is enforced here, at the door, not in the strategies: an
 * edit naming a file outside the plan's `authorizedFiles` throws before
 * anything is touched, whatever produced it — a deterministic strategy
 * with a bug and a model that wandered fail identically.
 */
import { logger } from '../../../shared/logger/index.js';
import { latestArtifact, writeArtifact } from './artifact-store.js';
import { diffLines } from './line-diff.js';
import type { ArtifactType } from '../../../shared/contracts/index.js';
import type { FileChangeRecord, FileEdit, RepairChangeset } from '../../../shared/types/repair.js';

/** The artifact types that carry project files, with their area prefix. */
const FILE_ARTIFACTS: { type: ArtifactType; prefix: string }[] = [
  { type: 'backend-source', prefix: 'backend/' },
  { type: 'backend-config', prefix: 'backend/' },
  { type: 'frontend-source', prefix: 'frontend/' },
  { type: 'frontend-config', prefix: 'frontend/' },
];

interface FileCarrier {
  files?: { path: string; content: string }[];
}

export interface LocatedFile {
  artifactType: ArtifactType;
  artifactVersion: number;
  /** Path inside the artifact, without the area prefix. */
  innerPath: string;
  /** Area-prefixed path, as plans and findings write it. */
  path: string;
  content: string;
}

/** Finds one project file by its area-prefixed path, in the latest artifacts. */
export function locateFile(projectId: string, path: string): LocatedFile | null {
  for (const { type, prefix } of FILE_ARTIFACTS) {
    if (!path.startsWith(prefix)) continue;
    const record = latestArtifact(projectId, type);
    const files = (record?.content as FileCarrier | undefined)?.files ?? [];
    const inner = path.slice(prefix.length);
    const file = files.find((entry) => entry.path === inner);
    if (file && record) {
      return {
        artifactType: type,
        artifactVersion: record.version,
        innerPath: inner,
        path,
        content: file.content,
      };
    }
  }
  return null;
}

export class UnauthorizedEditError extends Error {}
export class EditApplyError extends Error {}

/**
 * Applies a set of edits and writes new artifact versions.
 *
 * Rules, all enforced before the first write:
 *  - every edited file must be in `authorizedFiles`;
 *  - every `find` must occur exactly once — zero is a stale edit,
 *    two is ambiguity, and both fail the repair rather than guess;
 *  - all-or-nothing per repair: any failure means no artifact changes.
 *
 * Returns the changeset with real line diffs, computed from what actually
 * changed rather than from what the strategy claimed it would change.
 */
export function applyEdits(
  projectId: string,
  runId: string,
  repairId: string,
  findingId: string,
  reason: string,
  edits: readonly FileEdit[],
  authorizedFiles: readonly string[],
): RepairChangeset {
  const authorized = new Set(authorizedFiles);

  /* ── Validate everything before touching anything ─────────────────── */

  const located = new Map<string, LocatedFile>();
  for (const edit of edits) {
    if (!authorized.has(edit.file)) {
      throw new UnauthorizedEditError(
        `The repair attempted to modify ${edit.file}, which the plan does not authorize.`,
      );
    }
    const file = located.get(edit.file) ?? locateFile(projectId, edit.file);
    if (!file) throw new EditApplyError(`${edit.file} does not exist in the project artifacts.`);
    located.set(edit.file, file);
  }

  const updated = new Map<string, { before: string; after: string; file: LocatedFile }>();
  for (const edit of edits) {
    const file = located.get(edit.file);
    if (!file) throw new EditApplyError(`${edit.file} was not located.`);
    const current = updated.get(edit.file)?.after ?? file.content;
    const occurrences = current.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new EditApplyError(`The fragment to replace was not found in ${edit.file}.`);
    }
    if (occurrences > 1) {
      throw new EditApplyError(
        `The fragment to replace occurs ${String(occurrences)} times in ${edit.file}; an ambiguous edit is not applied.`,
      );
    }
    updated.set(edit.file, {
      before: file.content,
      after: current.replace(edit.find, edit.replace),
      file,
    });
  }

  /* ── Write, one new version per touched artifact ──────────────────── */

  const byArtifact = new Map<ArtifactType, Map<string, string>>();
  for (const [, change] of updated) {
    const changes = byArtifact.get(change.file.artifactType) ?? new Map<string, string>();
    changes.set(change.file.innerPath, change.after);
    byArtifact.set(change.file.artifactType, changes);
  }

  const versions = new Map<ArtifactType, { previous: number; next: number }>();
  for (const [type, changes] of byArtifact) {
    const record = latestArtifact(projectId, type);
    if (!record) throw new EditApplyError(`Artifact ${type} vanished mid-repair.`);
    const carrier = record.content as FileCarrier & Record<string, unknown>;
    const next = {
      ...carrier,
      files: (carrier.files ?? []).map((entry) =>
        changes.has(entry.path)
          ? { ...entry, content: changes.get(entry.path) ?? entry.content }
          : entry,
      ),
    };
    const written = writeArtifact({
      projectId,
      runId,
      type,
      agentId: 'repair-engineer',
      agentVersion: '1.0.0',
      derivedFrom: [record.id],
      content: next,
    });
    versions.set(type, { previous: record.version, next: written.version });
  }

  const files: FileChangeRecord[] = [...updated.entries()].map(([path, change]) => {
    const diff = diffLines(change.before, change.after);
    const version = versions.get(change.file.artifactType) ?? { previous: 0, next: 0 };
    return {
      file: path,
      addedLines: diff.added,
      removedLines: diff.removed,
      hunks: diff.hunks,
      previousVersion: version.previous,
      newVersion: version.next,
    };
  });

  logger.info('repair changeset applied', {
    projectId,
    repairId,
    files: files.map(
      (entry) => `${entry.file} (+${String(entry.addedLines)}/−${String(entry.removedLines)})`,
    ),
  });

  return {
    repairId,
    findingId,
    agentId: 'repair-engineer',
    reason,
    files,
    createdAt: new Date().toISOString(),
    rolledBack: false,
  };
}

/**
 * Restores the pre-repair content, as a new version.
 *
 * The rollback is itself recorded history: version N was the repair,
 * version N+1 is its reversal, and both stay readable. A rollback that
 * rewrote history would make "what did NexArch change?" unanswerable.
 */
export function rollbackChangeset(
  projectId: string,
  runId: string,
  changeset: RepairChangeset,
  snapshot: ReadonlyMap<string, string>,
): void {
  const byArtifact = new Map<ArtifactType, Map<string, string>>();
  for (const change of changeset.files) {
    const before = snapshot.get(change.file);
    const file = locateFile(projectId, change.file);
    if (before === undefined || !file) continue;
    const changes = byArtifact.get(file.artifactType) ?? new Map<string, string>();
    changes.set(file.innerPath, before);
    byArtifact.set(file.artifactType, changes);
  }

  for (const [type, changes] of byArtifact) {
    const record = latestArtifact(projectId, type);
    if (!record) continue;
    const carrier = record.content as FileCarrier & Record<string, unknown>;
    writeArtifact({
      projectId,
      runId,
      type,
      agentId: 'repair-engineer',
      agentVersion: '1.0.0',
      derivedFrom: [record.id],
      content: {
        ...carrier,
        files: (carrier.files ?? []).map((entry) =>
          changes.has(entry.path)
            ? { ...entry, content: changes.get(entry.path) ?? entry.content }
            : entry,
        ),
      },
    });
  }

  changeset.rolledBack = true;
  logger.info('repair rolled back', { projectId, repairId: changeset.repairId });
}

/** The pre-repair content of every authorized file — the reversible state. */
export function snapshotFiles(projectId: string, paths: readonly string[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const path of paths) {
    const file = locateFile(projectId, path);
    if (file) snapshot.set(path, file.content);
  }
  return snapshot;
}
