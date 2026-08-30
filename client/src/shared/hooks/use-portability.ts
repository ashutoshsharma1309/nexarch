import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  exportProjectPackage,
  importProjectPackage,
  runDemo,
} from '@/shared/services/portability.service';

/** Exports a project and hands the caller the package to download. */
export function useExportProject() {
  return useMutation({
    mutationFn: (projectId: string) => exportProjectPackage(projectId),
  });
}

export function useImportProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pkg: unknown) => importProjectPackage(pkg),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useRunDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runDemo(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
