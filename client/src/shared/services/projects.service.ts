import type { Project } from '@/shared/types/api';

/**
 * Projects data access — scaffold.
 *
 * The generation module ships project CRUD in Phase 2; until then the
 * server has no `/projects` surface. This service is the seam where that
 * lands: the UI already consumes it through React Query, so wiring the
 * real endpoint is a one-line change here and zero changes in features.
 */
export function fetchProjects(): Promise<Project[]> {
  // Phase 2: return unwrap((await apiClient.get<ApiSuccess<Project[]>>('/projects')).data);
  return Promise.resolve([]);
}
