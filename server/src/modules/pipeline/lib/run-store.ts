/**
 * Run persistence.
 *
 * A pipeline run has two halves with completely different lifetimes, and
 * conflating them would be a mistake in either direction:
 *
 *   • Live stage state — seven stages flipping status every few hundred
 *     milliseconds, polled once a second. It belongs in memory. Writing it
 *     to MySQL would mean a row update per stage transition to serve data
 *     that is worthless thirty seconds later.
 *
 *   • The record that the run happened — which project it belongs to, what
 *     was asked for, how it ended. That belongs in the database, because
 *     "show me this project's runs" must survive a restart.
 *
 * So this module persists the second half only, into the `generations`
 * table that has existed since Phase 1 and was never written to. The
 * in-memory run object in `pipeline.service.ts` stays the source of truth
 * for progress; this is the durable spine underneath it.
 *
 * A failed write here never fails a run. Losing the audit row is bad;
 * throwing away a generated project because an audit row could not be
 * written is worse.
 */
import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { logger } from '../../../shared/logger/index.js';
import type { Run, RunStatus } from '../../../shared/contracts/project.js';

/* In-memory generation log for no-DB mode — the run audit trail without MySQL. */
interface MemGeneration {
  id: string;
  projectId: string;
  prompt: string;
  status: string;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const memGenerations = new Map<string, MemGeneration>();
const useMemory = (): boolean => !config.database.enabled;

function memToRun(row: MemGeneration): Run {
  return {
    id: row.id,
    projectId: row.projectId,
    prompt: row.prompt,
    status: row.status as RunStatus,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Test/no-DB helper: the in-memory generations for a project. */
export function memGenerationsForProject(projectId: string): Run[] {
  return [...memGenerations.values()]
    .filter((row) => row.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(memToRun);
}

interface GenerationRow {
  id: string;
  projectId: string;
  prompt: string;
  status: string;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRun(row: GenerationRow): Run {
  return {
    id: row.id,
    projectId: row.projectId,
    prompt: row.prompt,
    status: row.status as RunStatus,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Opens the durable record for a run. `id` is the in-memory run's id, used
 * verbatim as the row's primary key so the two halves address the same run
 * and no correlation table is needed.
 */
export async function openRun(id: string, projectId: string, prompt: string): Promise<void> {
  if (useMemory()) {
    const now = new Date();
    memGenerations.set(id, {
      id,
      projectId,
      prompt,
      status: 'ANALYZING',
      error: null,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  try {
    await prisma.generation.create({
      data: { id, projectId, prompt, status: 'ANALYZING', startedAt: new Date() },
    });
  } catch (error) {
    logger.warn('run record could not be opened', { runId: id, error });
  }
}

export async function closeRun(
  id: string,
  status: Extract<RunStatus, 'COMPLETED' | 'FAILED'>,
  error: string | null = null,
): Promise<void> {
  if (useMemory()) {
    const row = memGenerations.get(id);
    if (row) {
      row.status = status;
      row.error = error;
      row.completedAt = new Date();
      row.updatedAt = row.completedAt;
    }
    return;
  }
  try {
    await prisma.generation.update({
      where: { id },
      data: { status, error, completedAt: new Date() },
    });
  } catch (cause) {
    logger.warn('run record could not be closed', { runId: id, error: cause });
  }
}

/** Every run of one project, newest first. The read side of Project → Run. */
export async function listRunsForProject(projectId: string, limit = 50): Promise<Run[]> {
  if (useMemory()) return memGenerationsForProject(projectId).slice(0, limit);
  const rows = await prisma.generation.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toRun);
}
