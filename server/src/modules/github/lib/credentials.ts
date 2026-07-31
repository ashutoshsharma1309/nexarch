/**
 * Credential resolution, isolated so the rest of the module never touches
 * an environment variable. Reads `GITHUB_TOKEN` directly from
 * `process.env` rather than the platform's core env schema — the same
 * documented convention the AI Orchestrator's provider keys use:
 * integration tokens are optional and per-deployment, not something every
 * deployment needs, so they don't belong in the required-config surface.
 *
 * The abstraction point for future credential sources (per-user OAuth
 * tokens stored in the database) is this file: swap the resolver, nothing
 * else changes.
 */
import { AppError } from '../../../shared/utils/app-error.js';

export interface GithubCredentials {
  token: string;
  source: 'environment';
}

export function resolveCredentials(): GithubCredentials | null {
  const token = process.env.GITHUB_TOKEN;
  return token && token.trim().length > 0 ? { token, source: 'environment' } : null;
}

/** Gate for endpoints that hit the GitHub API — fails fast with a clear enable path. */
export function requireCredentials(): GithubCredentials {
  const credentials = resolveCredentials();
  if (!credentials) {
    throw AppError.forbidden(
      'GitHub integration is disabled — set GITHUB_TOKEN (a fine-grained personal access token with repo scope) and restart the server',
    );
  }
  return credentials;
}
