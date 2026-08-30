/**
 * Engineering review API — the review mesh's findings and summary.
 *
 * Findings are project-scoped, not run-scoped: they outlive the run that
 * observed them, and the server deduplicates re-observations into one
 * record. Status changes are a person's judgement and go through PATCH.
 */
import { apiClient, unwrap } from './api-client';
import type {
  ApiSuccess,
  EngineeringReviewEnvelope,
  FindingRecord,
  FindingStatus,
  ProjectIntelligenceView,
  RepairsView,
  RepairSessionView,
  ValidationView,
} from '@/shared/types/api';

export async function fetchEngineeringReview(
  projectId: string,
  version?: number,
): Promise<EngineeringReviewEnvelope> {
  const query = version === undefined ? '' : `?version=${String(version)}`;
  const { data } = await apiClient.get<ApiSuccess<EngineeringReviewEnvelope>>(
    `/projects/${projectId}/engineering-review${query}`,
  );
  return unwrap(data);
}

export async function fetchFindings(projectId: string): Promise<FindingRecord[]> {
  const { data } = await apiClient.get<ApiSuccess<FindingRecord[]>>(
    `/projects/${projectId}/findings`,
  );
  return unwrap(data);
}

export async function updateFindingStatus(
  projectId: string,
  findingId: string,
  status: FindingStatus,
): Promise<FindingRecord> {
  const { data } = await apiClient.patch<ApiSuccess<FindingRecord>>(
    `/projects/${projectId}/findings/${findingId}`,
    { status },
  );
  return unwrap(data);
}

export async function fetchValidation(projectId: string): Promise<ValidationView> {
  const { data } = await apiClient.get<ApiSuccess<ValidationView>>(
    `/projects/${projectId}/validation`,
  );
  return unwrap(data);
}

export async function fetchRepairs(projectId: string): Promise<RepairsView> {
  const { data } = await apiClient.get<ApiSuccess<RepairsView>>(`/projects/${projectId}/repairs`);
  return unwrap(data);
}

export async function startRepairs(projectId: string): Promise<RepairSessionView> {
  const { data } = await apiClient.post<ApiSuccess<RepairSessionView>>(
    `/projects/${projectId}/repairs`,
  );
  return unwrap(data);
}

export async function fetchProjectIntelligence(
  projectId: string,
): Promise<ProjectIntelligenceView> {
  const { data } = await apiClient.get<ApiSuccess<ProjectIntelligenceView>>(
    `/projects/${projectId}/intelligence/summary`,
  );
  return unwrap(data);
}
