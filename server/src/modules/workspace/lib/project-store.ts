/**
 * Project persistence.
 *
 * Two backends behind one interface, chosen at boot by `config.database.enabled`:
 *
 *   • Prisma/MySQL when a DATABASE_URL is set — the durable store, owner-scoped
 *     so one user's project list can never contain another's, with slugs unique
 *     per owner.
 *   • An in-memory Map when no database is configured — the zero-setup mode.
 *     Same shape, same ownership scoping; it simply resets when the process does.
 *
 * The row shape was written against the schema from the start, which is what
 * lets the two paths return identical `Project` objects.
 */
import { randomUUID } from 'node:crypto';

import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { slugify } from '../../../shared/utils/strings.js';
import type {
  CreateProjectInput,
  ListProjectsQuery,
  Project,
  UpdateProjectInput,
} from '../workspace.types.js';

/** The columns a `Project` is built from — keeps every query selecting the same set. */
const SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  favorite: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  favorite: boolean;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    favorite: row.favorite,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function normalizeDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/* ── In-memory backend (no DATABASE_URL) ──────────────────────────────── */

const memory = new Map<string, ProjectRow>();
const useMemory = (): boolean => !config.database.enabled;

function memOwned(ownerId: string): ProjectRow[] {
  return [...memory.values()].filter((row) => row.ownerId === ownerId);
}

function memUniqueSlug(ownerId: string, name: string, excludeId?: string): string {
  const base = slugify(name, { maxLength: 120, fallback: 'project' });
  const taken = new Set(
    memOwned(ownerId)
      .filter((row) => row.id !== excludeId && row.slug.startsWith(base))
      .map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/* ── Public API — branches to the configured backend ──────────────────── */

/** Slug for a name, disambiguated against this owner's existing projects only. */
export async function uniqueSlug(
  ownerId: string,
  name: string,
  excludeId?: string,
): Promise<string> {
  if (useMemory()) return memUniqueSlug(ownerId, name, excludeId);
  const base = slugify(name, { maxLength: 120, fallback: 'project' });
  const taken = new Set(
    (
      await prisma.project.findMany({
        where: { ownerId, slug: { startsWith: base } },
        select: { id: true, slug: true },
      })
    )
      .filter((row) => row.id !== excludeId)
      .map((row) => row.slug),
  );

  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export async function createProject(ownerId: string, input: CreateProjectInput): Promise<Project> {
  const name = input.name.trim();
  if (useMemory()) {
    const now = new Date();
    const row: ProjectRow = {
      id: randomUUID(),
      ownerId,
      name,
      slug: memUniqueSlug(ownerId, name),
      description: normalizeDescription(input.description),
      status: 'DRAFT',
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    memory.set(row.id, row);
    return toProject(row);
  }
  const row = await prisma.project.create({
    data: {
      ownerId,
      name,
      slug: await uniqueSlug(ownerId, name),
      description: normalizeDescription(input.description),
    },
    select: SELECT,
  });
  return toProject(row);
}

export async function listProjects(
  ownerId: string,
  query: ListProjectsQuery = {},
): Promise<Project[]> {
  const search = query.search?.trim();
  if (useMemory()) {
    const term = search?.toLowerCase();
    return memOwned(ownerId)
      .filter((row) => (query.status ? row.status === query.status : true))
      .filter((row) => (query.favorite !== undefined ? row.favorite === query.favorite : true))
      .filter((row) =>
        term
          ? row.name.toLowerCase().includes(term) || row.slug.toLowerCase().includes(term)
          : true,
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toProject);
  }
  const rows = await prisma.project.findMany({
    where: {
      ownerId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
      ...(search ? { OR: [{ name: { contains: search } }, { slug: { contains: search } }] } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: SELECT,
  });
  return rows.map(toProject);
}

export async function getProject(ownerId: string, id: string): Promise<Project | undefined> {
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) return undefined;
    if (row.ownerId !== ownerId) return undefined;
    return toProject(row);
  }
  const row = await prisma.project.findFirst({ where: { id, ownerId }, select: SELECT });
  return row ? toProject(row) : undefined;
}

export async function updateProject(
  ownerId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<Project | undefined> {
  const name = input.name?.trim();
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) return undefined;
    if (row.ownerId !== ownerId) return undefined;
    if (name) {
      row.name = name;
      row.slug = memUniqueSlug(ownerId, name, id);
    }
    if (input.description !== undefined) row.description = normalizeDescription(input.description);
    if (input.status) row.status = input.status;
    if (input.favorite !== undefined) row.favorite = input.favorite;
    row.updatedAt = new Date();
    return toProject(row);
  }
  const existing = await getProject(ownerId, id);
  if (!existing) return undefined;

  const row = await prisma.project.update({
    where: { id },
    data: {
      ...(name ? { name, slug: await uniqueSlug(ownerId, name, id) } : {}),
      ...(input.description !== undefined
        ? { description: normalizeDescription(input.description) }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
    },
    select: SELECT,
  });
  return toProject(row);
}

export async function deleteProject(ownerId: string, id: string): Promise<boolean> {
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) return false;
    if (row.ownerId !== ownerId) return false;
    memory.delete(id);
    return true;
  }
  // Scoped delete: `deleteMany` with the owner in the filter cannot remove
  // another user's row even if the id is guessed.
  const { count } = await prisma.project.deleteMany({ where: { id, ownerId } });
  return count > 0;
}

export async function duplicateProject(ownerId: string, id: string): Promise<Project | undefined> {
  const source = await getProject(ownerId, id);
  if (!source) return undefined;

  const name = `${source.name} (copy)`;
  if (useMemory()) {
    const now = new Date();
    const row: ProjectRow = {
      id: randomUUID(),
      ownerId,
      name,
      slug: memUniqueSlug(ownerId, name),
      description: source.description,
      status: 'DRAFT',
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    memory.set(row.id, row);
    return toProject(row);
  }
  const row = await prisma.project.create({
    data: {
      ownerId,
      name,
      slug: await uniqueSlug(ownerId, name),
      description: source.description,
      // A copy starts clean: it has produced nothing and nobody has pinned it.
      status: 'DRAFT',
      favorite: false,
    },
    select: SELECT,
  });
  return toProject(row);
}

export async function projectStatistics(ownerId: string): Promise<{
  totalProjects: number;
  activeProjects: number;
  archivedProjects: number;
  favoriteProjects: number;
}> {
  if (useMemory()) {
    const owned = memOwned(ownerId);
    return {
      totalProjects: owned.length,
      activeProjects: owned.filter((row) => row.status === 'ACTIVE').length,
      archivedProjects: owned.filter((row) => row.status === 'ARCHIVED').length,
      favoriteProjects: owned.filter((row) => row.favorite).length,
    };
  }
  const [totalProjects, activeProjects, archivedProjects, favoriteProjects] = await Promise.all([
    prisma.project.count({ where: { ownerId } }),
    prisma.project.count({ where: { ownerId, status: 'ACTIVE' } }),
    prisma.project.count({ where: { ownerId, status: 'ARCHIVED' } }),
    prisma.project.count({ where: { ownerId, favorite: true } }),
  ]);
  return { totalProjects, activeProjects, archivedProjects, favoriteProjects };
}

/**
 * Find a project by slug, or create it. The pipeline uses this to give every
 * run a home without asking the user to manage projects first — the
 * project-per-prompt behaviour that keeps the existing one-prompt flow
 * intact while the Run/Project relationship becomes real underneath it.
 */
export async function findOrCreateBySlug(ownerId: string, name: string): Promise<Project> {
  const slug = slugify(name, { maxLength: 120, fallback: 'project' });
  if (useMemory()) {
    const existing = memOwned(ownerId).find((row) => row.slug === slug);
    if (existing) return toProject(existing);
    const now = new Date();
    const row: ProjectRow = {
      id: randomUUID(),
      ownerId,
      name: name.trim(),
      slug,
      description: null,
      status: 'ACTIVE',
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    memory.set(row.id, row);
    return toProject(row);
  }
  const existing = await prisma.project.findFirst({ where: { ownerId, slug }, select: SELECT });
  if (existing) return toProject(existing);

  const row = await prisma.project.create({
    data: { ownerId, name: name.trim(), slug, status: 'ACTIVE' },
    select: SELECT,
  });
  return toProject(row);
}
