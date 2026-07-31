/**
 * Railway adapter. Railway's public GraphQL API deploys services connected
 * to a repository, so — like Render — the honest scope is triggering and
 * monitoring a redeploy of an existing service. Needs `RAILWAY_TOKEN`
 * plus `RAILWAY_SERVICE_ID` and `RAILWAY_ENVIRONMENT_ID`, read per the
 * documented provider-key convention.
 */
import { AppError } from '../../../../shared/utils/app-error.js';
import type {
  DeployEventSink,
  DeployProviderAdapter,
  ProviderDeployRequest,
  ProviderDeployResult,
} from './provider.types.js';

const API_URL = 'https://backboard.railway.app/graphql/v2';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

interface GraphQlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function railwayQuery<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    if (response.status === 401 || response.status === 403) {
      throw AppError.unauthorized(`Railway rejected the token: ${detail}`);
    }
    throw AppError.internal(`Railway API error (${String(response.status)}): ${detail}`);
  }
  const parsed = (await response.json()) as GraphQlResponse<T>;
  if (parsed.errors && parsed.errors.length > 0) {
    throw AppError.internal(
      `Railway GraphQL error: ${parsed.errors.map((e) => e.message).join('; ')}`,
    );
  }
  if (!parsed.data) throw AppError.internal('Railway returned an empty GraphQL response');
  return parsed.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RailwayProvider implements DeployProviderAdapter {
  readonly id = 'railway' as const;
  readonly name = 'Railway';
  readonly requiredEnv = ['RAILWAY_TOKEN', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID'];
  readonly docsUrl = 'https://docs.railway.com/reference/public-api';
  readonly strategy =
    'Triggers and monitors a redeploy of the Railway service connected to your repository';

  isConfigured(): boolean {
    return Boolean(
      process.env.RAILWAY_TOKEN &&
      process.env.RAILWAY_SERVICE_ID &&
      process.env.RAILWAY_ENVIRONMENT_ID,
    );
  }

  async deploy(
    _request: ProviderDeployRequest,
    events: DeployEventSink,
  ): Promise<ProviderDeployResult> {
    const token = process.env.RAILWAY_TOKEN;
    const serviceId = process.env.RAILWAY_SERVICE_ID;
    const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
    if (!token || !serviceId || !environmentId) {
      throw AppError.forbidden(
        'Railway deploys are disabled — set RAILWAY_TOKEN, RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID',
      );
    }

    events.transition('building', `Triggering redeploy of Railway service ${serviceId}`);
    const redeploy = await railwayQuery<{ serviceInstanceRedeploy: boolean }>(
      token,
      `mutation redeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId, environmentId },
    );
    if (!redeploy.serviceInstanceRedeploy) {
      throw AppError.internal('Railway declined the redeploy request');
    }

    events.transition('deploying', 'Railway redeploy accepted — polling latest deployment');
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) {
        throw AppError.internal('Railway deploy timed out after 10 minutes of polling');
      }
      await sleep(POLL_INTERVAL_MS);

      const result = await railwayQuery<{
        deployments: {
          edges: { node: { id: string; status: string; staticUrl: string | null } }[];
        };
      }>(
        token,
        `query latest($serviceId: String!, $environmentId: String!) {
          deployments(
            first: 1
            input: { serviceId: $serviceId, environmentId: $environmentId }
          ) {
            edges { node { id status staticUrl } }
          }
        }`,
        { serviceId, environmentId },
      );

      const node = result.deployments.edges[0]?.node;
      if (!node) continue;
      events.transition('monitoring', `Railway status: ${node.status}`);
      if (node.status === 'SUCCESS') {
        return {
          url: node.staticUrl ? `https://${node.staticUrl}` : 'https://railway.app/dashboard',
          vendorId: node.id,
        };
      }
      if (['FAILED', 'CRASHED', 'REMOVED'].includes(node.status)) {
        throw AppError.internal(`Railway deployment ended in status "${node.status}"`);
      }
    }
  }
}
