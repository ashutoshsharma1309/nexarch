import { useQuery } from '@tanstack/react-query';

import { fetchProjects } from '@/shared/services/projects.service';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });
}
