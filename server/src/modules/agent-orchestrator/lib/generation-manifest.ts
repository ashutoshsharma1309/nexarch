/**
 * What this generation run actually did to the project's files.
 *
 * The generators emit a complete file set every time — that is what makes
 * them deterministic and worth keeping. But "emitted 176 files" is not an
 * answer to "what changed", and on a second run it is actively misleading:
 * a reader sees 176 and assumes 176 files of work, when the truthful
 * number might be two.
 *
 * So the manifest diffs the emitted set against the previous version of
 * the same artifact and classifies each path:
 *
 *   CREATE   — the project did not have this file before
 *   UPDATE   — it did, and the content differs
 *   PRESERVE — it did, and the content is identical
 *   DELETE   — it did, and this run's generator no longer emits it
 *
 * DELETE is reported, never performed here. A file vanishing from a
 * generator's output is worth surfacing; deleting a file from a user's
 * workspace because a generator changed its mind is not this layer's call
 * to make. The runner writes what the manifest describes, and it writes
 * only what an agent emitted.
 */
import type { AgentId } from '../../../shared/contracts/index.js';
import type {
  FileChange,
  FileOperation,
  GenerationManifest,
} from '../../../shared/types/generation.js';

export interface ManifestFile {
  path: string;
  content: string;
}

export interface ManifestSource {
  agentId: AgentId;
  /** What this run emitted. */
  files: readonly ManifestFile[];
  /** What the previous version of this artifact held, if there was one. */
  previous: readonly ManifestFile[];
}

/**
 * Where a path lives, for the per-area totals.
 *
 * The generators emit into `backend/` and `frontend/` once their output is
 * merged into a project, but each emits project-relative paths of its own
 * (`src/modules/...`). The agent that produced the file is therefore the
 * reliable signal, and the path is only consulted for files no agent
 * claims.
 */
function areaOf(agentId: AgentId): 'backend' | 'frontend' | 'shared' {
  if (agentId === 'backend-engineer') return 'backend';
  if (agentId === 'frontend-engineer' || agentId === 'ux-ui-engineer') return 'frontend';
  return 'shared';
}

function classify(file: ManifestFile, previous: Map<string, string>): FileOperation {
  const before = previous.get(file.path);
  if (before === undefined) return 'CREATE';
  return before === file.content ? 'PRESERVE' : 'UPDATE';
}

/**
 * Builds the manifest from every generating agent's output.
 *
 * Sources are processed in order and a path is attributed to the first
 * agent that emitted it, so a UX pass that rewrites a frontend file
 * updates the frontend engineer's entry rather than creating a second
 * record of the same path.
 */
export function buildManifest(
  projectId: string,
  runId: string,
  sources: readonly ManifestSource[],
  generatedAt: string,
): GenerationManifest {
  const changes: FileChange[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const previous = new Map(source.previous.map((file) => [file.path, file.content]));

    for (const file of source.files) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      changes.push({
        path: file.path,
        operation: classify(file, previous),
        agentId: source.agentId,
        sizeBytes: Buffer.byteLength(file.content, 'utf8'),
      });
    }

    // Paths the previous version had and this one does not. Reported so a
    // regeneration that drops a module is visible, not acted on.
    for (const path of previous.keys()) {
      if (seen.has(path)) continue;
      seen.add(path);
      changes.push({ path, operation: 'DELETE', agentId: source.agentId, sizeBytes: 0 });
    }
  }

  const byAgent: GenerationManifest['byAgent'] = {};
  const byArea = { backend: 0, frontend: 0, shared: 0 };

  for (const change of changes) {
    const entry = (byAgent[change.agentId] ??= { created: 0, updated: 0, preserved: 0 });
    if (change.operation === 'CREATE') entry.created += 1;
    if (change.operation === 'UPDATE') entry.updated += 1;
    if (change.operation === 'PRESERVE') entry.preserved += 1;
    if (change.operation !== 'DELETE') byArea[areaOf(change.agentId)] += 1;
  }

  const count = (operation: FileOperation): number =>
    changes.filter((change) => change.operation === operation).length;

  return {
    projectId,
    runId,
    generatedAt,
    changes,
    totals: {
      created: count('CREATE'),
      updated: count('UPDATE'),
      preserved: count('PRESERVE'),
      deleted: count('DELETE'),
      total: changes.filter((change) => change.operation !== 'DELETE').length,
    },
    byAgent,
    byArea,
  };
}

/** One line a human can read, for the agent summary and the run log. */
export function describeManifest(manifest: GenerationManifest): string {
  const { created, updated, preserved, deleted } = manifest.totals;
  const parts = [`${created} created`, `${updated} updated`, `${preserved} preserved`];
  if (deleted > 0) parts.push(`${deleted} dropped`);
  return parts.join(' · ');
}
