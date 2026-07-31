/**
 * The one list of deploy providers. Adding a vendor = one adapter file +
 * one line here — the execution manager, routes, and client all discover
 * providers through this registry and never name a vendor directly.
 */
import { RailwayProvider } from './railway-provider.js';
import { RenderProvider } from './render-provider.js';
import { VercelProvider } from './vercel-provider.js';
import type { DeployProviderAdapter } from './provider.types.js';
import type { DeployProviderId, DeployProviderStatus } from '../../deployment.types.js';

const providers: readonly DeployProviderAdapter[] = [
  new VercelProvider(),
  new RailwayProvider(),
  new RenderProvider(),
];

export function getProvider(id: DeployProviderId): DeployProviderAdapter | null {
  return providers.find((provider) => provider.id === id) ?? null;
}

export function listProviderStatuses(): DeployProviderStatus[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    configured: provider.isConfigured(),
    requiredEnv: provider.requiredEnv,
    docsUrl: provider.docsUrl,
    strategy: provider.strategy,
  }));
}
