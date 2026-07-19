/**
 * Auth module — scaffold.
 *
 * Phase 3 implements JWT authentication here: registration, login, token
 * refresh, and the `requireAuth` / `requireRole` middleware other modules
 * will import from this module's public surface (this index file only).
 * bcrypt, jsonwebtoken, and the validated JWT_* config are already wired so
 * the implementation lands without new infrastructure.
 */
import type { AppModule } from '../../shared/types/module.js';
import { createScaffoldRouter } from '../../shared/utils/module-scaffold.js';

export const authModule: AppModule = {
  name: 'auth',
  basePath: '/auth',
  description: 'User registration, JWT sessions and role-based access control',
  router: createScaffoldRouter({
    module: 'auth',
    summary: 'User registration, JWT sessions and role-based access control',
    plannedPhase: 3,
    capabilities: ['register', 'login', 'refresh', 'logout', 'role-guards'],
    status: 'scaffold',
  }),
};
