/**
 * In-memory Project CRUD.
 *
 * `Project.owner` is a required, cascading foreign key to `User` in
 * `prisma/schema.prisma`, and no auth module exists yet to supply a real
 * `ownerId` (the `auth` module is still a Phase 3 scaffold). Persisting real
 * rows now would mean fabricating a fake owner — worse than being honest
 * about the gap. This store keeps the exact `Project` shape the schema
 * defines (so swapping in a Prisma-backed implementation later is a
 * function-body change, not a type change) while living in-memory, the same
 * continuity model used by the Security Engine's report cache, the
 * Dependency Graph's version manifest, and the AI Orchestrator's history —
 * "most recent state for this process," reset on restart.
 */
import type {
  CreateProjectInput,
  ListProjectsQuery,
  Project,
  UpdateProjectInput,
} from '../workspace.types.js';

const projects = new Map<string, Project>();
let counter = 0;

function nextId(): string {
  counter += 1;
  return `proj_${Date.now().toString(36)}${counter.toString(36)}`;
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug === '' ? 'project' : slug;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function uniqueSlug(base: string, excludeId?: string): string {
  let slug = base;
  let suffix = 1;
  const taken = (candidate: string): boolean =>
    Array.from(projects.values()).some((p) => p.slug === candidate && p.id !== excludeId);
  while (taken(slug)) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

export function createProject(input: CreateProjectInput): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: nextId(),
    name: input.name.trim(),
    slug: uniqueSlug(slugify(input.name)),
    description: normalizeDescription(input.description),
    status: 'DRAFT',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
  projects.set(project.id, project);
  return project;
}

export function listProjects(query: ListProjectsQuery = {}): Project[] {
  let results = Array.from(projects.values());
  if (query.search) {
    const needle = query.search.trim().toLowerCase();
    results = results.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle),
    );
  }
  if (query.status) {
    results = results.filter((p) => p.status === query.status);
  }
  if (query.favorite !== undefined) {
    results = results.filter((p) => p.favorite === query.favorite);
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project | undefined {
  return projects.get(id);
}

export function updateProject(id: string, input: UpdateProjectInput): Project | undefined {
  const existing = projects.get(id);
  if (!existing) return undefined;

  const updated: Project = {
    ...existing,
    name: input.name?.trim() ?? existing.name,
    slug: input.name ? uniqueSlug(slugify(input.name), id) : existing.slug,
    description:
      input.description !== undefined
        ? normalizeDescription(input.description)
        : existing.description,
    status: input.status ?? existing.status,
    favorite: input.favorite ?? existing.favorite,
    updatedAt: new Date().toISOString(),
  };
  projects.set(id, updated);
  return updated;
}

export function deleteProject(id: string): boolean {
  return projects.delete(id);
}

export function duplicateProject(id: string): Project | undefined {
  const source = projects.get(id);
  if (!source) return undefined;

  const now = new Date().toISOString();
  const copy: Project = {
    ...source,
    id: nextId(),
    name: `${source.name} (copy)`,
    slug: uniqueSlug(slugify(`${source.name}-copy`)),
    status: 'DRAFT',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
  projects.set(copy.id, copy);
  return copy;
}

export function projectStatistics(): {
  totalProjects: number;
  activeProjects: number;
  archivedProjects: number;
  favoriteProjects: number;
} {
  const all = Array.from(projects.values());
  return {
    totalProjects: all.length,
    activeProjects: all.filter((p) => p.status === 'ACTIVE').length,
    archivedProjects: all.filter((p) => p.status === 'ARCHIVED').length,
    favoriteProjects: all.filter((p) => p.favorite).length,
  };
}

/** Test-only: reset state between test files. */
export function _resetProjectStore(): void {
  projects.clear();
  counter = 0;
}
