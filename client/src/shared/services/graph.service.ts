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
  EngGraphValidationReport,
  EngNodeType,
  EngineeringGraph,
  GraphImpactAnalysis,
  GraphPath,
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

/**
 * Recompute the graph from the project's latest completed build.
 *
 * Every build already syncs the graph, so this is the manual path: it exists
 * for a graph read after a server restart, and for a reader who wants to be
 * sure what they are looking at is current.
 */
export async function refreshGraph(projectId: string): Promise<EngineeringGraph> {
  const { data } = await apiClient.post<ApiSuccess<EngineeringGraph>>(
    `/projects/${projectId}/graph/refresh`,
    undefined,
    { timeout: 60_000 },
  );
  return unwrap(data);
}

/**
 * The chain the graph holds between two nodes, or null when there is none.
 *
 * The traversal is the server's: it walks real edges, so a path that comes
 * back is one the project actually has. A null answer means no path exists
 * and must be shown as that, not as an empty diagram.
 */
export async function fetchGraphPath(
  projectId: string,
  fromId: string,
  toId: string,
): Promise<GraphPath | null> {
  const { data } = await apiClient.get<ApiSuccess<GraphPath | null>>(
    `/projects/${projectId}/graph/nodes/${fromId}/path`,
    // `any` walks an edge from either end. Without it a requirement can
    // reach nothing: every edge about a requirement points at it, not away.
    { params: { to: toId, direction: 'any' }, timeout: 30_000 },
  );
  return unwrap(data);
}
