/**
 * Engineering Graph API.
 *
 * The whole graph is a few hundred nodes, so it is fetched once per
 * project and every panel reads from that. Node-level detail (impact,
 * neighbourhood) is fetched on selection because those are traversals the
 * server does better than the browser would.
 */
import { apiClient, unwrap } from './api-client';
import type {
  ApiSuccess,
  EngineeringGraph,
  GraphImpactAnalysis,
  EngNodeType,
  EngGraphValidationReport,
  NodeNeighbourhood,
} from '@/shared/types/api';

export async function fetchGraph(projectId: string, type?: EngNodeType): Promise<EngineeringGraph> {
  const { data } = await apiClient.get<ApiSuccess<EngineeringGraph>>(
    `/projects/${projectId}/graph`,
    { params: type ? { type } : undefined, timeout: 30_000 },
  );
  return unwrap(data);
}

export async function fetchGraphNode(
  projectId: string,
  nodeId: string,
): Promise<NodeNeighbourhood> {
  const { data } = await apiClient.get<ApiSuccess<NodeNeighbourhood>>(
    `/projects/${projectId}/graph/nodes/${nodeId}`,
  );
  return unwrap(data);
}

export async function fetchGraphImpact(
  projectId: string,
  nodeId: string,
): Promise<GraphImpactAnalysis> {
  const { data } = await apiClient.get<ApiSuccess<GraphImpactAnalysis>>(
    `/projects/${projectId}/graph/impact/${nodeId}`,
  );
  return unwrap(data);
}

export async function fetchGraphValidation(projectId: string): Promise<EngGraphValidationReport> {
  const { data } = await apiClient.get<ApiSuccess<EngGraphValidationReport>>(
    `/projects/${projectId}/graph/validate`,
  );
  return unwrap(data);
}
