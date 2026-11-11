/**
 * Tracing one node to another, and the three things that can come back.
 *
 * A trace has exactly three answers and they must not look alike: a chain
 * the project genuinely holds, "there is no path between these" — a real
 * finding, not an empty state — and "the traversal failed", which says
 * nothing about the project at all. Collapsing any two of those would let
 * this panel report a broken request as a disconnected project.
 *
 * The chain itself is only worth drawing if a reader can see why each hop
 * exists, so the hop's relationship, the direction its edge actually points
 * and the evidence the edge carries are all asserted here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchGraph,
  fetchGraphImpact,
  fetchGraphNode,
  fetchGraphPath,
  fetchGraphValidation,
  refreshGraph,
} from '@/shared/services/graph.service';
import type { EngGraphNode, EngNodeType, GraphPath } from '@/shared/types/api';
import { TraceTo } from './trace-to';

vi.mock('@/shared/services/graph.service', () => ({
  fetchGraph: vi.fn(),
  fetchGraphNode: vi.fn(),
  fetchGraphImpact: vi.fn(),
  fetchGraphValidation: vi.fn(),
  refreshGraph: vi.fn(),
  fetchGraphPath: vi.fn(),
}));

const mockedFetchGraphPath = vi.mocked(fetchGraphPath);

function node(id: string, type: EngNodeType, name: string): EngGraphNode {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    type,
    canonicalName: name.toLowerCase(),
    name,
    description: null,
    metadata: {},
    sourceArtifactId: null,
    createdAt: '',
    updatedAt: '',
  };
}

const REQUIREMENT = node('n1', 'REQUIREMENT', 'Customers can place an order');
const FEATURE = node('n2', 'FEATURE', 'Orders');
const FILE = node('n3', 'FILE', 'order.service.ts');

/** Requirement → Feature is walked against the IMPLEMENTS edge's direction. */
const PATH: GraphPath = {
  nodes: [REQUIREMENT, FEATURE, FILE],
  relationships: ['IMPLEMENTS', 'GENERATES'],
  hops: [
    { relationship: 'IMPLEMENTS', direction: 'backward', metadata: {} },
    {
      relationship: 'GENERATES',
      direction: 'forward',
      metadata: { evidence: 'import-statement', specifier: './orders/order.module' },
    },
  ],
};

/** Pick a destination, which is what makes the traversal run at all. */
async function traceTo(destination: EngGraphNode): Promise<UserEvent> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <TraceTo
        projectId="p1"
        origin={REQUIREMENT}
        nodes={[REQUIREMENT, FEATURE, FILE]}
        onFocusNode={vi.fn()}
      />
    </QueryClientProvider>,
  );

  await user.type(screen.getByRole('textbox'), destination.name);
  await user.click(screen.getByRole('button', { name: new RegExp(destination.name, 'i') }));
  return user;
}

beforeEach(() => {
  mockedFetchGraphPath.mockReset();
  vi.mocked(fetchGraph).mockReset();
  vi.mocked(fetchGraphNode).mockReset();
  vi.mocked(fetchGraphImpact).mockReset();
  vi.mocked(fetchGraphValidation).mockReset();
  vi.mocked(refreshGraph).mockReset();
});

describe('a path the graph holds', () => {
  it('renders one hop per relationship, with its evidence and its real direction', async () => {
    mockedFetchGraphPath.mockResolvedValue(PATH);

    await traceTo(FILE);

    const chain = within(await screen.findByRole('list'));

    // Every node on the chain, in the order the server returned them.
    expect(chain.getByText('Customers can place an order')).toBeInTheDocument();
    expect(chain.getByText('Orders')).toBeInTheDocument();
    expect(chain.getByText('order.service.ts')).toBeInTheDocument();

    // One hop per relationship, each naming the relationship it walked.
    expect(chain.getByText('IMPLEMENTS')).toBeInTheDocument();
    expect(chain.getByText('GENERATES')).toBeInTheDocument();
    expect(chain.getByText('2 hops, following edges the graph holds.')).toBeInTheDocument();

    // A reversed hop is marked: a feature IMPLEMENTS a requirement, so
    // reaching the feature from the requirement walks that edge backwards,
    // and smoothing that over would misstate what the graph says.
    expect(chain.getByText('(reversed)')).toBeInTheDocument();

    // And the hop that has evidence shows it.
    expect(chain.getByText('imports ./orders/order.module')).toBeInTheDocument();
  });

  it('does not claim a hop is unexplained when the server sent no evidence for it', async () => {
    mockedFetchGraphPath.mockResolvedValue({
      nodes: [REQUIREMENT, FEATURE],
      relationships: ['IMPLEMENTS'],
      hops: [{ relationship: 'IMPLEMENTS', direction: 'backward', metadata: {} }],
    });

    await traceTo(FEATURE);

    expect(await screen.findByText('IMPLEMENTS')).toBeInTheDocument();
    // The details panel says "no evidence recorded" about an edge it holds.
    // A hop is not that: the walk may simply not have carried the edge's
    // metadata, and a trace must not turn silence into a finding.
    expect(screen.queryByText(/no evidence/i)).not.toBeInTheDocument();
  });
});

describe('the other two answers', () => {
  it('a null result says the two are unconnected, which is a finding about the project', async () => {
    mockedFetchGraphPath.mockResolvedValue(null);

    await traceTo(FILE);

    expect(await screen.findByText(/holds no path from/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing connects them/i)).toBeInTheDocument();
    // Nothing is drawn, because there is nothing to draw — and no hop count
    // is claimed for a path that does not exist.
    expect(screen.queryByText(/following edges the graph holds/)).not.toBeInTheDocument();
  });

  it('a failed traversal says so instead of reporting a disconnected project', async () => {
    mockedFetchGraphPath.mockRejectedValue(new Error('Request failed with status code 500'));

    await traceTo(FILE);

    expect(await screen.findByText(/could not be traced/i)).toBeInTheDocument();
    expect(screen.getByText(/status code 500/)).toBeInTheDocument();
    expect(screen.queryByText(/holds no path from/i)).not.toBeInTheDocument();
  });
});
