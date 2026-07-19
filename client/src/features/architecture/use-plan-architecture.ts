import { useMutation } from '@tanstack/react-query';

import { planArchitecture } from '@/shared/services/architecture.service';

export function usePlanArchitecture() {
  return useMutation({ mutationFn: planArchitecture });
}
