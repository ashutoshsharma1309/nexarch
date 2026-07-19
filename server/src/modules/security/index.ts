/**
 * Security module — scaffold.
 *
 * Future home of security injection for generated applications: dependency
 * audit, header/middleware hardening, secret detection, and the security
 * report attached to every generation run. Platform-level security (Helmet,
 * CORS, rate limiting) is infrastructure and lives in `src/shared/middleware`
 * — this module hardens the *output*, not the platform.
 */
import type { AppModule } from '../../shared/types/module.js';
import { createScaffoldRouter } from '../../shared/utils/module-scaffold.js';

export const securityModule: AppModule = {
  name: 'security',
  basePath: '/security',
  description: 'Security analysis and hardening of generated applications',
  router: createScaffoldRouter({
    module: 'security',
    summary: 'Security analysis and hardening of generated applications',
    plannedPhase: 2,
    capabilities: ['audit-dependencies', 'harden-output', 'detect-secrets', 'security-report'],
    status: 'scaffold',
  }),
};
