/**
 * Whether the workspace is honest about which build it is showing.
 *
 * The stale banner is the one claim on this screen that is about the map
 * rather than about the project, and it used to be wrong in the ordinary
 * case: the server reports `runId: null` whenever the loaded nodes disagree
 * on it, which is what an applied edit leaves behind — the edit resyncs its
 * own slice under its own run id while everything it did not touch keeps the
 * old one. Comparing that null against the latest run told every edited
 * project its graph was out of date, which trains a reader to ignore the one
 * warning that matters.
 *
 * So these tests are about what the banner says, against graphs shaped the
 * way the server really shapes them. The canvas is React Flow's and is
 * stubbed: it has no part in this question and measuring a zero-sized
 * container in jsdom is not worth the noise.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchGraph,
  fetchGraphImpact,
  fetchGraphNode,
  fetchGraphPath,
  fetchGraphValidation,
  refreshGraph,
} from '@/shared/services/graph.service';
import type { EngGraphNode, EngineeringGraph } from '@/shared/types/api';
import { GraphWorkspace } from './graph-workspace';

vi.mock('@/shared/services/graph.service', () => ({
  fetchGraph: vi.fn(),
  fetchGraphNode: vi.fn(),
  fetchGraphImpact: vi.fn(),
  fetchGraphValidation: vi.fn(),
  refreshGraph: vi.fn(),
  fetchGraphPath: vi.fn(),
}));

vi.mock('./graph-canvas', () => ({
  GraphCanvas: () => <div aria-label="Engineering graph canvas" />,
}));

const mockedFetchGraph = vi.mocked(fetchGraph);

function node(id: string, runId: string): EngGraphNode {
  return {
    id,
    projectId: 'p1',
    runId,
    type: 'SERVICE',
    canonicalName: id,
    name: id,
    description: null,
    metadata: {},
    sourceArtifactId: null,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * A graph as the server assembles it: `runId` only when every node agrees,
 * `runIds` listing every run that is really in there.
 */
function graph(runIds: string[]): EngineeringGraph {
  const nodes = runIds.map((runId, index) => node(`n${String(index)}`, runId));
  return {
    projectId: 'p1',
    runId: runIds.length === 1 ? (runIds[0] ?? null) : null,
    runIds,
    nodes,
    edges: [],
    stats: {
      nodeCount: nodes.length,
      edgeCount: 0,
      nodesByType: { SERVICE: nodes.length },
      edgesByRelationship: {},
    },
    generatedAt: new Date().toISOString(),
  };
}

function renderWorkspace(latestRunId: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GraphWorkspace projectId="p1" latestRunId={latestRunId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The banner's own words, so a reworded warning is still found. */
const STALE = /does not include the project/i;

beforeEach(() => {
  mockedFetchGraph.mockReset();
  vi.mocked(fetchGraphValidation).mockReset();
  vi.mocked(fetchGraphNode).mockReset();
  vi.mocked(fetchGraphImpact).mockReset();
  vi.mocked(refreshGraph).mockReset();
  vi.mocked(fetchGraphPath).mockReset();

  vi.mocked(fetchGraphValidation).mockResolvedValue({
    valid: true,
    checkedNodes: 2,
    checkedEdges: 0,
    issues: [],
    skippedChecks: [],
  });
});

describe('the stale-graph banner', () => {
  it('stays quiet when the graph spans several runs but holds the latest one', async () => {
    // The state an applied edit leaves: two runs in one graph, so the server
    // names none of them. This is current, not stale.
    mockedFetchGraph.mockResolvedValue(graph(['run-1', 'run-2']));

    renderWorkspace('run-2');

    await screen.findByLabelText('Engineering graph canvas');
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    // And the reader is told why one graph names no single run, because
    // "spans two builds" is information rather than a fault.
    expect(screen.getByText(/spans 2 builds of this project/i)).toBeInTheDocument();
  });

  it('warns when the latest build is not in the graph at all', async () => {
    mockedFetchGraph.mockResolvedValue(graph(['run-1', 'run-2']));

    renderWorkspace('run-3');

    expect(await screen.findByText(STALE)).toBeInTheDocument();
  });

  it('stays quiet on a single-run graph of the latest build', async () => {
    mockedFetchGraph.mockResolvedValue(graph(['run-7']));

    renderWorkspace('run-7');

    await screen.findByLabelText('Engineering graph canvas');
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    expect(screen.queryByText(/spans/i)).not.toBeInTheDocument();
  });

  it('warns on a single-run graph of an older build', async () => {
    mockedFetchGraph.mockResolvedValue(graph(['run-6']));

    renderWorkspace('run-7');

    expect(await screen.findByText(STALE)).toBeInTheDocument();
  });
});
