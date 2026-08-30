import { useQuery } from '@tanstack/react-query';

import {
  fetchGraph,
  fetchGraphImpact,
  fetchGraphNode,
  fetchGraphValidation,
} from '@/shared/services/graph.service';

/** The graph changes only when a build runs, so it is cached until one does. */
export function useProjectGraph(projectId: string | undefined) {
  return useQuery({
    queryKey: ['graph', projectId],
    // `enabled` guarantees the id by the time this runs; throwing says so
    // without an assertion that lies about the type.
    queryFn: () => {
      if (!projectId) throw new Error('No project selected');
      return fetchGraph(projectId);
    },
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
}

export function useGraphNode(projectId: string | undefined, nodeId: string | null) {
  return useQuery({
    queryKey: ['graph', projectId, 'node', nodeId],
    queryFn: () => {
      if (!projectId || !nodeId) throw new Error('No node selected');
      return fetchGraphNode(projectId, nodeId);
    },
    enabled: Boolean(projectId && nodeId),
    staleTime: 60_000,
  });
}

export function useGraphImpact(projectId: string | undefined, nodeId: string | null) {
  return useQuery({
    queryKey: ['graph', projectId, 'impact', nodeId],
    queryFn: () => {
      if (!projectId || !nodeId) throw new Error('No node selected');
      return fetchGraphImpact(projectId, nodeId);
    },
    enabled: Boolean(projectId && nodeId),
    staleTime: 60_000,
  });
}

export function useGraphValidation(projectId: string | undefined) {
  return useQuery({
    queryKey: ['graph', projectId, 'validate'],
    queryFn: () => {
      if (!projectId) throw new Error('No project selected');
      return fetchGraphValidation(projectId);
    },
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
}
