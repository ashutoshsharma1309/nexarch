/**
 * Vercel adapter — the one provider that takes source files directly:
 * POST /v13/deployments with inline files, then poll until READY. Reads
 * `VERCEL_TOKEN` directly from `process.env` per the platform's documented
 * provider-key convention (optional, per-deployment, not part of the
 * required config surface).
 */
import { AppError } from '../../../../shared/utils/app-error.js';
import type {
  DeployEventSink,
  DeployProviderAdapter,
  ProviderDeployRequest,
  ProviderDeployResult,
} from './provider.types.js';

const API_BASE = 'https://api.vercel.com';
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

interface VercelDeployment {
  id: string;
  url: string;
  readyState: 'QUEUED' | 'BUILDING' | 'INITIALIZING' | 'READY' | 'ERROR' | 'CANCELED';
}

async function vercelRequest<T>(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    if (response.status === 401 || response.status === 403) {
      throw AppError.unauthorized(`Vercel rejected the token: ${detail}`);
    }
    throw AppError.internal(`Vercel API error (${String(response.status)}): ${detail}`);
  }
  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VercelProvider implements DeployProviderAdapter {
  readonly id = 'vercel' as const;
  readonly name = 'Vercel';
  readonly requiredEnv = ['VERCEL_TOKEN'];
  readonly docsUrl = 'https://vercel.com/docs/rest-api/endpoints/deployments';
  readonly strategy = 'Uploads the project files inline and creates a production deployment';

  isConfigured(): boolean {
    return Boolean(process.env.VERCEL_TOKEN);
  }

  async deploy(
    request: ProviderDeployRequest,
    events: DeployEventSink,
  ): Promise<ProviderDeployResult> {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw AppError.forbidden('Vercel deploys are disabled — set VERCEL_TOKEN');

    events.transition('building', `Uploading ${String(request.files.length)} files to Vercel`);
    const created = await vercelRequest<VercelDeployment>(token, 'POST', '/v13/deployments', {
      name: request.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      target: 'production',
      files: request.files.map((file) => ({ file: file.path, data: file.content })),
      projectSettings: { framework: null },
      ...(Object.keys(request.env).length > 0 ? { env: request.env } : {}),
    });

    events.transition('deploying', `Vercel deployment ${created.id} created`);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let deployment = created;
    while (deployment.readyState !== 'READY') {
      if (deployment.readyState === 'ERROR' || deployment.readyState === 'CANCELED') {
        throw AppError.internal(`Vercel deployment ended in ${deployment.readyState}`);
      }
      if (Date.now() > deadline) {
        throw AppError.internal('Vercel deployment timed out after 5 minutes of polling');
      }
      await sleep(POLL_INTERVAL_MS);
      deployment = await vercelRequest<VercelDeployment>(
        token,
        'GET',
        `/v13/deployments/${created.id}`,
      );
      events.transition('monitoring', `Vercel readyState: ${deployment.readyState}`);
    }

    return { url: `https://${deployment.url}`, vendorId: deployment.id };
  }
}
