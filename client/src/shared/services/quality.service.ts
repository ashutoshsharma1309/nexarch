import type {
  ApiSuccess,
  CodeQualityReport,
  EngineeringBundle,
  ExportResult,
  PerformanceReport,
  QualityArtifacts,
  QualityDocumentationBundle,
  QualityExportFormat,
  ReleaseReadiness,
  TestingReport,
} from '@/shared/types/api';
import { apiClient, unwrap } from './api-client';

export async function analyzeQuality(artifacts: QualityArtifacts): Promise<EngineeringBundle> {
  const response = await apiClient.post<ApiSuccess<EngineeringBundle>>('/quality/analyze', {
    artifacts,
  });
  return unwrap(response.data);
}

export async function runTesting(artifacts: QualityArtifacts): Promise<TestingReport> {
  const response = await apiClient.post<ApiSuccess<TestingReport>>('/testing/run', { artifacts });
  return unwrap(response.data);
}

export async function generateDocumentation(
  artifacts: QualityArtifacts,
): Promise<QualityDocumentationBundle> {
  const response = await apiClient.post<ApiSuccess<QualityDocumentationBundle>>(
    '/documentation/generate',
    {
      artifacts,
    },
  );
  return unwrap(response.data);
}

export async function exportQuality(
  format: QualityExportFormat,
  artifacts: QualityArtifacts,
): Promise<ExportResult> {
  const response = await apiClient.post<ApiSuccess<ExportResult>>('/quality/export', {
    format,
    artifacts,
  });
  return unwrap(response.data);
}

export async function getQualityReport(): Promise<CodeQualityReport> {
  const response = await apiClient.get<ApiSuccess<CodeQualityReport>>('/quality/report');
  return unwrap(response.data);
}

export async function getPerformanceReport(): Promise<PerformanceReport> {
  const response = await apiClient.get<ApiSuccess<PerformanceReport>>('/performance/report');
  return unwrap(response.data);
}

export async function getReleaseReadiness(): Promise<ReleaseReadiness> {
  const response = await apiClient.get<ApiSuccess<ReleaseReadiness>>('/release/readiness');
  return unwrap(response.data);
}
