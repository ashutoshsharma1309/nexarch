import { useMutation } from '@tanstack/react-query';

import { analyzePrompt } from '@/shared/services/analysis.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import { useForgeStore } from './forge-store';

/**
 * Run requirement analysis, record the outcome in prompt history, and — on
 * a COMPLETE result — publish the spec as the pipeline's working artifact
 * so the Architecture view can consume it.
 */
export function useAnalyze() {
  const addHistory = useForgeStore((state) => state.addHistory);
  const setSpec = usePipelineStore((state) => state.setSpec);

  return useMutation({
    mutationFn: analyzePrompt,
    onSuccess: (result, prompt) => {
      addHistory({
        prompt,
        status: result.status,
        projectType:
          result.status === 'COMPLETE' ? result.spec.projectType : result.detection.projectType,
      });
      if (result.status === 'COMPLETE') {
        setSpec(result.spec);
      }
    },
  });
}
