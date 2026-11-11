/**
 * What the details panel claims about a node.
 *
 * The panel's job is to render the server's answer about one node, and the
 * ways it can mislead are all claims it makes on its own: saying a node has
 * no relationships when the request for them failed, printing an arrow with
 * nothing behind it so a derived relationship reads as an assertion, showing
 * a capped blast radius as a finished one, and telling a reader there is no
 * source artifact when there is one that simply has no page here.
 *
 * So each test below is about a sentence a user reads, not about the queries
 * underneath. The graph service is mocked at the import boundary the way the
 * rest of this suite mocks services, and the panel is rendered with the
 * impact section already open where the subject is impact — that section is
 * opened by the workspace around it, not by this component.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
import type {
  EngGraphEdge,
  EngGraphNode,
  EngNodeType,
  EngRelationship,
  GraphImpactAnalysis,
  NodeNeighbourhood,
} from '@/shared/types/api';
import { NodeDetails } from './node-details';

vi.mock('@/shared/services/graph.service', () => ({
  fetchGraph: vi.fn(),
  fetchGraphNode: vi.fn(),
  fetchGraphImpact: vi.fn(),
  fetchGraphValidation: vi.fn(),
  refreshGraph: vi.fn(),
  fetchGraphPath: vi.fn(),
}));

const mockedFetchGraphNode = vi.mocked(fetchGraphNode);
const mockedFetchGraphImpact = vi.mocked(fetchGraphImpact);

function node(
  id: string,
  type: EngNodeType,
  name: string,
  sourceArtifactId: string | null = null,
): EngGraphNode {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    type,
    canonicalName: name.toLowerCase(),
    name,
    description: null,
    metadata: {},
    sourceArtifactId,
    createdAt: '',
    updatedAt: '',
  };
}

function edge(
  id: string,
  relationship: EngRelationship,
  metadata: Record<string, unknown>,
): EngGraphEdge {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    sourceNodeId: 'n1',
    targetNodeId: id,
    relationship,
    metadata,
    createdAt: '',
  };
}

const ORDER_SERVICE = node('n1', 'SERVICE', 'OrderService');

function impacted(
  id: string,
  depth: number,
  reason: string,
): GraphImpactAnalysis['impacted'][number] {
  return {
    node: node(id, 'FILE', id),
    depth,
    via: 'DEPENDS_ON',
    direction: 'backward',
    // What the server states, and what the panel groups by: one edge away,
    // or reached through a chain.
    direct: depth <= 1,
    reason,
  };
}

function renderDetails(
  subject: EngGraphNode = ORDER_SERVICE,
  options: { impactOpen?: boolean } = {},
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NodeDetails
          projectId="p1"
          node={subject}
          nodes={[subject]}
          impactOpen={options.impactOpen ?? false}
          onToggleImpact={vi.fn()}
          onFocusNode={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The list that sits under a heading in the panel, once it is on screen. */
async function groupUnder(heading: string): Promise<HTMLElement> {
  const label = await screen.findByText(heading);
  const group = label.parentElement;
  if (group === null) throw new Error(`expected a group around "${heading}"`);
  return group;
}

beforeEach(() => {
  mockedFetchGraphNode.mockReset();
  mockedFetchGraphImpact.mockReset();
  vi.mocked(fetchGraph).mockReset();
  vi.mocked(fetchGraphValidation).mockReset();
  vi.mocked(refreshGraph).mockReset();
  vi.mocked(fetchGraphPath).mockReset();
});

describe('relationships', () => {
  it('shows the evidence each edge carries for why two things are connected', async () => {
    const neighbourhood: NodeNeighbourhood = {
      node: ORDER_SERVICE,
      outgoing: [
        {
          edge: edge('n2', 'DEPENDS_ON', {
            evidence: 'import-statement',
            specifier: './order.repository',
          }),
          node: node('n2', 'FILE', 'order.repository.ts'),
        },
        {
          edge: edge('n3', 'BELONGS_TO', { foreignKey: 'user_id', onDelete: 'cascade' }),
          node: node('n3', 'ENTITY', 'Users'),
        },
        // An edge the builder annotated with nothing. The reader has to be
        // able to tell this apart from the two above.
        { edge: edge('n4', 'CONTAINS', {}), node: node('n4', 'FIELD', 'Orders.total') },
      ],
      incoming: [
        {
          edge: edge('n5', 'USES', { reason: 'checkout reads stock levels' }),
          node: node('n5', 'SERVICE', 'CheckoutService'),
        },
      ],
    };
    mockedFetchGraphNode.mockResolvedValue(neighbourhood);

    renderDetails();

    // The relationship type and the evidence for it, together: an import
    // specifier, a foreign key, a stated reason.
    expect(await screen.findByText('imports ./order.repository')).toBeInTheDocument();
    expect(screen.getByText('foreign key user_id, on delete cascade')).toBeInTheDocument();
    expect(screen.getByText('checkout reads stock levels')).toBeInTheDocument();
    expect(screen.getByText('DEPENDS_ON')).toBeInTheDocument();
    expect(screen.getByText('BELONGS_TO')).toBeInTheDocument();

    // And the one with nothing behind it says so rather than reading as an
    // explained relationship.
    expect(screen.getByText('no evidence recorded')).toBeInTheDocument();

    // Direction is still kept apart, because "what this uses" and "what uses
    // this" are different questions.
    expect(
      within(await groupUnder('Depended on by')).getByText('CheckoutService'),
    ).toBeInTheDocument();
    expect(
      within(await groupUnder('Depends on / contains')).getByText('order.repository.ts'),
    ).toBeInTheDocument();
  });

  it('a failed request reads as a failure, not as a node with no relationships', async () => {
    mockedFetchGraphNode.mockRejectedValue(new Error('Network Error'));

    renderDetails();

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/has no relationships/i)).not.toBeInTheDocument();
  });

  it('a node that genuinely has none says that instead', async () => {
    mockedFetchGraphNode.mockResolvedValue({
      node: ORDER_SERVICE,
      outgoing: [],
      incoming: [],
    });

    renderDetails();

    expect(await screen.findByText(/has no relationships/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });
});

describe('the source artifact', () => {
  beforeEach(() => {
    mockedFetchGraphNode.mockResolvedValue({ node: ORDER_SERVICE, outgoing: [], incoming: [] });
  });

  it('offers the page a finding was written on', async () => {
    renderDetails(node('f1', 'FINDING', 'Unvalidated order total', 'engineering-review'));

    expect(await screen.findByRole('button', { name: /view in review/i })).toBeInTheDocument();
  });

  it('does not claim a node has no source artifact when it has one with no page', async () => {
    renderDetails(node('n9', 'FEATURE', 'Checkout', 'product-spec'));

    expect(
      await screen.findByText('Its source artifact (product-spec) has no page in this workspace'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No source artifact for this node')).not.toBeInTheDocument();
  });

  it('says there is none when there really is none', async () => {
    renderDetails(node('n10', 'PROJECT', 'Shop', null));

    expect(await screen.findByText('No source artifact for this node')).toBeInTheDocument();
  });
});

describe('impact', () => {
  beforeEach(() => {
    mockedFetchGraphNode.mockResolvedValue({ node: ORDER_SERVICE, outgoing: [], incoming: [] });
  });

  it('separates what the change touches from what it only reaches', async () => {
    mockedFetchGraphImpact.mockResolvedValue({
      origin: ORDER_SERVICE,
      impacted: [
        impacted('order.controller.ts', 1, 'order.controller.ts calls this service directly'),
        impacted('checkout.e2e.ts', 3, 'checkout.e2e.ts is reached through CheckoutService'),
      ],
      summary: { FILE: 2 },
      directCount: 1,
      indirectCount: 1,
      maxDepth: 3,
      truncated: false,
    });

    renderDetails(ORDER_SERVICE, { impactOpen: true });

    const direct = within(await groupUnder('Directly depends on this'));
    expect(direct.getByText('order.controller.ts calls this service directly')).toBeInTheDocument();
    expect(
      direct.queryByText('checkout.e2e.ts is reached through CheckoutService'),
    ).not.toBeInTheDocument();

    expect(
      within(await groupUnder('Reached through something else')).getByText(
        'checkout.e2e.ts is reached through CheckoutService',
      ),
    ).toBeInTheDocument();
  });

  it('says when the list was cut short rather than presenting a cap as the answer', async () => {
    mockedFetchGraphImpact.mockResolvedValue({
      origin: ORDER_SERVICE,
      impacted: [impacted('order.controller.ts', 1, 'order.controller.ts calls this service')],
      summary: { FILE: 1 },
      directCount: 1,
      indirectCount: 0,
      maxDepth: 4,
      truncated: true,
    });

    renderDetails(ORDER_SERVICE, { impactOpen: true });

    expect(await screen.findByText(/more of the project is affected/i)).toBeInTheDocument();
  });

  it('does not warn about a cap on an answer that was not capped', async () => {
    mockedFetchGraphImpact.mockResolvedValue({
      origin: ORDER_SERVICE,
      impacted: [impacted('order.controller.ts', 1, 'order.controller.ts calls this service')],
      summary: { FILE: 1 },
      directCount: 1,
      indirectCount: 0,
      maxDepth: 4,
      truncated: false,
    });

    renderDetails(ORDER_SERVICE, { impactOpen: true });

    expect(await screen.findByText('order.controller.ts calls this service')).toBeInTheDocument();
    expect(screen.queryByText(/more of the project is affected/i)).not.toBeInTheDocument();
  });
});
