/**
 * Render adapter. Render deploys from a connected repository, not from
 * uploaded files — so this adapter's honest job is triggering and
 * monitoring a deploy of an existing service: POST
 * /v1/services/{id}/deploys, then poll the deploy status. Needs
 * `RENDER_API_KEY` plus `RENDER_SERVICE_ID` (which service to deploy),
 * both read per the documented provider-key convention.
 */
import { AppError } from '../../../../shared/utils/app-error.js';
import type {
  DeployEventSink,
  DeployProviderAdapter,
  ProviderDeployRequest,
  ProviderDeployResult,
} from './provider.types.js';

const API_BASE = 'https://api.render.com/v1';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

interface RenderDeploy {
  id: string;
  status: string; // created | build_in_progress | update_in_progress | live | *_failed | canceled
}

interface RenderService {
  serviceDetails?: { url?: string };
  name: string;
}

async function renderRequest<T>(
  key: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    if (response.status === 401 || response.status === 403) {
      throw AppError.unauthorized(`Render rejected the API key: ${detail}`);
    }
    throw AppError.internal(`Render API error (${String(response.status)}): ${detail}`);
  }
  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RenderProvider implements DeployProviderAdapter {
  readonly id = 'render' as const;
  readonly name = 'Render';
  readonly requiredEnv = ['RENDER_API_KEY', 'RENDER_SERVICE_ID'];
  readonly docsUrl = 'https://api-docs.render.com/reference/create-deploy';
  readonly strategy =
    'Triggers and monitors a deploy of the Render service connected to your repository';

  isConfigured(): boolean {
    return Boolean(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID);
  }

  async deploy(
    _request: ProviderDeployRequest,
    events: DeployEventSink,
  ): Promise<ProviderDeployResult> {
    const key = process.env.RENDER_API_KEY;
    const serviceId = process.env.RENDER_SERVICE_ID;
    if (!key || !serviceId) {
      throw AppError.forbidden(
        'Render deploys are disabled — set RENDER_API_KEY and RENDER_SERVICE_ID',
      );
    }

    events.transition('building', `Triggering deploy of Render service ${serviceId}`);
    const deploy = await renderRequest<RenderDeploy>(
      key,
      'POST',
      `/services/${serviceId}/deploys`,
      { clearCache: 'do_not_clear' },
    );

    events.transition('deploying', `Render deploy ${deploy.id} started`);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let current = deploy;
    while (current.status !== 'live') {
      if (current.status.endsWith('_failed') || current.status === 'canceled') {
        throw AppError.internal(`Render deploy ended in status "${current.status}"`);
      }
      if (Date.now() > deadline) {
        throw AppError.internal('Render deploy timed out after 10 minutes of polling');
      }
      await sleep(POLL_INTERVAL_MS);
      current = await renderRequest<RenderDeploy>(
        key,
        'GET',
        `/services/${serviceId}/deploys/${deploy.id}`,
      );
      events.transition('monitoring', `Render status: ${current.status}`);
    }

    const service = await renderRequest<RenderService>(key, 'GET', `/services/${serviceId}`);
    return {
      url: service.serviceDetails?.url ?? 'https://dashboard.render.com',
      vendorId: deploy.id,
    };
  }
}
