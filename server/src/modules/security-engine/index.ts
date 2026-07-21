/**
 * Security Engine (Phase 7).
 *
 * Consumes the requirement spec, architecture SDS, database design, OpenAPI
 * contract, and the Phase 5/6 manifests, and hardens the generated backend
 * and frontend in place: JWT auth + refresh tokens wired to a real identity
 * table, RBAC from entity-metadata.json, input sanitization, tiered rate
 * limits, CSRF, secure cookies, hardened headers/env validation, and a real
 * implementation of whichever /auth/* endpoints it can wire against the
 * database design — plus the security report, OWASP assessment, and RBAC/
 * permission config. Public surface: this module definition only.
 *
 * Supersedes the Phase 1 `security` scaffold, the same way `database-designer`
 * supersedes the Phase 1 `database` scaffold.
 */
import type { AppModule } from '../../shared/types/module.js';
import { securityEngineRouter } from './security-engine.router.js';

export const securityEngineModule: AppModule = {
  name: 'security-engine',
  basePath: '/security',
  description:
    'Analyzes and hardens generated applications: JWT/RBAC, OWASP audit, security report',
  router: securityEngineRouter,
};
