/**
 * Project portability and demo mode — the client side of Phase 15's
 * export/import/demo endpoints.
 *
 * Export returns the whole package as JSON; the caller turns it into a
 * downloadable file. Import takes a parsed package and creates a new
 * project from it. Demo creates or resets the user's demo project.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, Project } from '@/shared/types/api';

export async function exportProjectPackage(projectId: string): Promise<unknown> {
  const { data } = await apiClient.get<ApiSuccess<unknown>>(`/project/${projectId}/export`);
  return unwrap(data);
}

export async function importProjectPackage(
  pkg: unknown,
): Promise<{
  project: Project;
  imported: { artifacts: number; findings: number; graph: boolean };
}> {
  const { data } = await apiClient.post<
    ApiSuccess<{
      project: Project;
      imported: { artifacts: number; findings: number; graph: boolean };
    }>
  >('/projects/import', { package: pkg });
  return unwrap(data);
}

export async function runDemo(): Promise<{
  project: Project;
  seeded: { findings: number; repaired: number; artifacts: number };
}> {
  const { data } =
    await apiClient.post<
      ApiSuccess<{
        project: Project;
        seeded: { findings: number; repaired: number; artifacts: number };
      }>
    >('/demo');
  return unwrap(data);
}
