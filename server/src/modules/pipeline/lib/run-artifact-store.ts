/**
 * Durable storage for what a run produced.
 *
 * The pipeline keeps its runs in a bounded in-memory map, which is the right
 * home for live stage state — it changes every few hundred milliseconds and is
 * worthless a minute later. It was also, until this module existed, the only
 * home for the *output*: the generated files, the architecture, the design.
 * So a restart left a project showing a completed build with nothing behind
 * it. The Code tab had no files, the preview had nothing to run, an edit had
 * no baseline, and the knowledge graph — persisted all along — described a
 * file tree that existed nowhere.
 *
 * This is the other half of `run-store.ts`: that one records *that* a run
 * happened, this one records *what it produced*. Together they mean a
 * finished project survives the process that made it.
 *
 * Two rules carried over from the run store, for the same reasons:
 *
 * - A failed write never fails a run. Losing the durable copy is bad; throwing
 *   away a generated project because a database was briefly unreachable is
 *   worse. Writes are logged and swallowed.
 * - With no DATABASE_URL the module is a no-op that says so, rather than
 *   pretending to persist.
 */
import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { logger } from '../../../shared/logger/index.js';
import type { PipelineArtifacts } from '../pipeline.types.js';

/**
 * The shape this module writes. A bundle written by an older build with a
 * different shape is skipped on read rather than half-understood.
 */
const SCHEMA_VERSION = 1;

/**
 * How many bundles to keep per project. Each one is the whole generated
 * project, so an unbounded table would grow by a megabyte or so per build
 * forever; a project's recent history is what anyone actually opens.
 */
const KEEP_PER_PROJECT = 10;

const useDatabase = (): boolean => config.database.enabled;

/**
 * Persist a run's output.
 *
 * Returns whether it was stored, so a caller can report the truth rather than
 * assume. Never throws.
 */
export async function saveRunArtifacts(
  runId: string,
  projectId: string,
  artifacts: PipelineArtifacts,
): Promise<boolean> {
  if (!useDatabase()) return false;

  const payload = JSON.stringify(artifacts);
  try {
    await prisma.runArtifact.upsert({
      where: { runId },
      create: {
        runId,
        projectId,
        version: SCHEMA_VERSION,
        payload: JSON.parse(payload) as object,
        fileCount: artifacts.files.length,
        bytes: Buffer.byteLength(payload),
      },
      update: {
        payload: JSON.parse(payload) as object,
        fileCount: artifacts.files.length,
        bytes: Buffer.byteLength(payload),
        version: SCHEMA_VERSION,
      },
    });
    await pruneProject(projectId);
    return true;
  } catch (error) {
    logger.warn('run artifacts could not be persisted', {
      runId,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The stored bundle for a run, or null.
 *
 * Null covers every honest reason there is nothing to return — no database,
 * never written, pruned away, or written by a build whose shape this one does
 * not recognise. The caller's job is to say so, not to guess.
 */
export async function loadRunArtifacts(runId: string): Promise<PipelineArtifacts | null> {
  if (!useDatabase()) return null;

  try {
    const row = await prisma.runArtifact.findUnique({ where: { runId } });
    if (!row) return null;
    if (row.version !== SCHEMA_VERSION) {
      logger.warn('stored artifacts were written by a different build and were skipped', {
        runId,
        storedVersion: row.version,
        expected: SCHEMA_VERSION,
      });
      return null;
    }
    return row.payload as unknown as PipelineArtifacts;
  } catch (error) {
    logger.warn('stored artifacts could not be read', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Which of these runs have a stored bundle — one query, not one per run. */
export async function storedRunIds(runIds: readonly string[]): Promise<Set<string>> {
  if (!useDatabase() || runIds.length === 0) return new Set();
  try {
    const rows = await prisma.runArtifact.findMany({
      where: { runId: { in: [...runIds] }, version: SCHEMA_VERSION },
      select: { runId: true },
    });
    return new Set(rows.map((row) => row.runId));
  } catch (error) {
    logger.warn('stored artifact ids could not be listed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}

/**
 * Drop all but the newest bundles for a project.
 *
 * Deliberately after the write, not before: if pruning fails the project
 * still has its newest output, which is the thing that matters.
 */
async function pruneProject(projectId: string): Promise<void> {
  try {
    const keep = await prisma.runArtifact.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: KEEP_PER_PROJECT,
      select: { runId: true },
    });
    const { count } = await prisma.runArtifact.deleteMany({
      where: { projectId, runId: { notIn: keep.map((row) => row.runId) } },
    });
    if (count > 0) logger.info('pruned old run artifacts', { projectId, removed: count });
  } catch (error) {
    logger.warn('old run artifacts could not be pruned', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
