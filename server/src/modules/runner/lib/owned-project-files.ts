/**
 * Which files a run may execute, decided by the server.
 *
 * `POST /runner/sessions` used to write and run whatever the request body
 * contained, so any signed-in account could execute arbitrary code on this
 * machine by posting it. A run now executes only a stored generation from a
 * project the caller owns, and the bytes come from storage, never the body.
 *
 * Two request shapes reach that rule. `{ projectId, runId? }` names the
 * project outright. `{ projectName, files }` is what the preview page sends
 * today: the posted set is treated only as a claim about *which* generation
 * is meant, and is accepted when it is byte-identical to one the caller owns.
 */
import { createHash } from 'node:crypto';

import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { AppError } from '../../../shared/utils/app-error.js';
import {
  loadRunArtifacts,
  loadRunArtifactsForProject,
} from '../../pipeline/lib/run-artifact-store.js';
import type { RunnerFile } from '../runner.types.js';

export interface RunSelection {
  projectId?: string | undefined;
  runId?: string | undefined;
  projectName?: string | undefined;
  files?: RunnerFile[] | undefined;
}

export interface OwnedFiles {
  projectName: string;
  files: RunnerFile[];
}

/** The newest stored generations compared against a posted file set. */
const MAX_CANDIDATES = 25;

/** Independent of order, so a re-sorted listing still names the same generation. */
export function fileSetDigest(files: readonly RunnerFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path).update('\0').update(file.content).update('\0');
  }
  return hash.digest('hex');
}

export interface Bundle {
  architecture?: { meta?: { projectName?: string } };
  files: RunnerFile[];
}

function toOwned(bundle: Bundle, fallbackName: string): OwnedFiles {
  return {
    projectName: bundle.architecture?.meta?.projectName ?? fallbackName,
    files: bundle.files.map(({ path, content }) => ({ path, content })),
  };
}

/** Where generations come from. A seam so the rule can be tested without a database. */
export interface OwnedFilesSource {
  findOwnedProject: (
    projectId: string,
    ownerId: string,
  ) => Promise<{ id: string; name: string } | null>;
  latestRunId: (projectId: string) => Promise<string | null>;
  loadForProject: (runId: string, projectId: string) => Promise<Bundle | null>;
  bundlesInMemory: (ownerId: string) => Promise<Bundle[]>;
  /** Run ids the caller owns that could match this many files, newest first. */
  candidateRunIds: (ownerId: string, fileCount: number) => Promise<string[]>;
  load: (runId: string) => Promise<Bundle | null>;
}

const STORED_SOURCE: OwnedFilesSource = {
  findOwnedProject: async (projectId, ownerId) =>
    config.database.enabled
      ? prisma.project.findFirst({
          where: { id: projectId, ownerId },
          select: { id: true, name: true },
        })
      : null,
  latestRunId: async (projectId) => {
    const row = await prisma.runArtifact.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { runId: true },
    });
    return row?.runId ?? null;
  },
  loadForProject: loadRunArtifactsForProject,
  // Loaded on demand: the pipeline reaches most of the server, and the runner
  // is imported by parts of it, so a static import here is a load cycle.
  bundlesInMemory: async (ownerId) => {
    const { getArtifactsIfReady, listRuns } = await import('../../pipeline/pipeline.service.js');
    return listRuns(ownerId).flatMap((run) => {
      const bundle = getArtifactsIfReady(run.id);
      return bundle ? [bundle] : [];
    });
  },
  candidateRunIds: async (ownerId, fileCount) => {
    if (!config.database.enabled) return [];
    const rows = await prisma.runArtifact.findMany({
      where: { project: { ownerId }, fileCount },
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATES,
      select: { runId: true },
    });
    return rows.map((row) => row.runId);
  },
  load: loadRunArtifacts,
};

async function resolveByProject(
  source: OwnedFilesSource,
  projectId: string,
  runId: string | undefined,
  ownerId: string,
): Promise<OwnedFiles> {
  // One message for missing and not-yours, so ids cannot be probed.
  const project = await source.findOwnedProject(projectId, ownerId);
  if (!project) throw AppError.notFound('No such project');

  const resolvedRunId = runId ?? (await source.latestRunId(projectId));
  const bundle = resolvedRunId ? await source.loadForProject(resolvedRunId, projectId) : null;
  if (!bundle) throw AppError.notFound('This project has no stored generation to run');
  return toOwned(bundle, project.name);
}

async function resolveByContent(
  source: OwnedFilesSource,
  posted: readonly RunnerFile[],
  fallbackName: string,
  ownerId: string,
): Promise<OwnedFiles> {
  const wanted = fileSetDigest(posted);

  // Memory first: a run that just finished is here even if storage failed.
  for (const bundle of await source.bundlesInMemory(ownerId)) {
    if (fileSetDigest(bundle.files) === wanted) return toOwned(bundle, fallbackName);
  }

  for (const runId of await source.candidateRunIds(ownerId, posted.length)) {
    const bundle = await source.load(runId);
    if (bundle && fileSetDigest(bundle.files) === wanted) return toOwned(bundle, fallbackName);
  }

  throw AppError.forbidden('Only a generated project you own can be run');
}

/** The stored files this request may run. Throws when there are none. */
export async function resolveOwnedFiles(
  selection: RunSelection,
  ownerId: string,
  source: OwnedFilesSource = STORED_SOURCE,
): Promise<OwnedFiles> {
  if (selection.projectId) {
    return resolveByProject(source, selection.projectId, selection.runId, ownerId);
  }
  if (selection.files && selection.files.length > 0) {
    return resolveByContent(source, selection.files, selection.projectName ?? 'project', ownerId);
  }
  throw AppError.badRequest('Name a projectId to run');
}
