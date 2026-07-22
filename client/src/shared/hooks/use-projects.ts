import { useQuery } from '@tanstack/react-query';

import { listProjects } from '@/shared/services/workspace.service';
import type { ListProjectsParams } from '@/shared/services/workspace.service';

export function useProjects(params?: ListProjectsParams) {
  return useQuery({
    queryKey: ['projects', 'list', params],
    queryFn: () => listProjects(params),
  });
}
