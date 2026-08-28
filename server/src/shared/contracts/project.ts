/**
 * Project and Run contracts (v2 foundation).
 *
 * v2 is project-centric: User → Project → Run → Artifacts. Two of those
 * four already existed in `prisma/schema.prisma` from Phase 1 (`Project`,
 * `Generation`) and were never wired up — the project store ran in memory
 * because no auth module existed to supply a real owner. Auth exists now,
 * so this phase adopts the tables that were already there rather than
 * modelling projects a second time.
 *
 * `Run` is the domain name for a `Generation` row. The table keeps its
 * name — renaming it would be a destructive migration to buy vocabulary —
 * but every v2 surface says Run, because a run of the pipeline is what it
 * has always been.
 */

export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface Project {
  id: string;
  /** Owning user. The field the in-memory store could not supply. */
  ownerId: string;
  name: string;
  /** URL-safe unique name; predates v2 and stays. */
  slug: string;
  description: string | null;
  status: ProjectStatus;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the `GenerationStatus` enum already in the schema. */
export type RunStatus =
  'PENDING' | 'ANALYZING' | 'PLANNING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';

/** One execution of the generation pipeline, owned by a project. */
export interface Run {
  id: string;
  projectId: string;
  prompt: string;
  status: RunStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
