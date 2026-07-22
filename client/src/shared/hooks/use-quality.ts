import { useMutation } from '@tanstack/react-query';

import {
  analyzeQuality,
  exportQuality,
  generateDocumentation,
  runTesting,
} from '@/shared/services/quality.service';
import type { QualityArtifacts, QualityExportFormat } from '@/shared/types/api';

export function useAnalyzeQuality() {
  return useMutation({
    mutationFn: (artifacts: QualityArtifacts) => analyzeQuality(artifacts),
  });
}

export function useRunTesting() {
  return useMutation({
    mutationFn: (artifacts: QualityArtifacts) => runTesting(artifacts),
  });
}

export function useGenerateQualityDocumentation() {
  return useMutation({
    mutationFn: (artifacts: QualityArtifacts) => generateDocumentation(artifacts),
  });
}

export function useExportQuality() {
  return useMutation({
    mutationFn: ({
      format,
      artifacts,
    }: {
      format: QualityExportFormat;
      artifacts: QualityArtifacts;
    }) => exportQuality(format, artifacts),
  });
}
