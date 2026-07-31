/**
 * The provider abstraction for one-click deploy (Phase 13). Mirrors the AI
 * Orchestrator's ModelProvider pattern: a small interface, one adapter per
 * vendor, `isConfigured()` deciding live-vs-disabled per deployment — so
 * adding a provider is a new file plus one registry line, and nothing
 * outside `lib/providers/` knows any vendor's API shape.
 */
import type { DeployExecutionPhase, DeployProviderId } from '../../deployment.types.js';

export interface ProviderDeployFile {
  path: string;
  content: string;
}

export interface ProviderDeployRequest {
  projectName: string;
  files: ProviderDeployFile[];
  /** Environment variables the deployed app needs — forwarded, never logged. */
  env: Record<string, string>;
}

export interface ProviderDeployResult {
  /** Public URL of the live deployment. */
  url: string;
  /** Vendor-side deployment identifier, for support/debugging. */
  vendorId: string;
}

/** Adapters report progress through this sink so the execution manager owns all state. */
export interface DeployEventSink {
  transition(phase: DeployExecutionPhase, detail: string): void;
}

export interface DeployProviderAdapter {
  readonly id: DeployProviderId;
  readonly name: string;
  /** Env var(s) that switch this provider from disabled to live. */
  readonly requiredEnv: string[];
  readonly docsUrl: string;
  /** What the adapter actually does, shown in plans and provider listings. */
  readonly strategy: string;
  isConfigured(): boolean;
  deploy(request: ProviderDeployRequest, events: DeployEventSink): Promise<ProviderDeployResult>;
}
