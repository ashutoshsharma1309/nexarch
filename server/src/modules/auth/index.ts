/**
 * Auth module — local email/password accounts with JWT sessions carried in
 * httpOnly cookies. This is the platform's only identity provider: there is
 * no third-party OAuth, by design, so a local install needs nothing beyond
 * a database to sign its first user in.
 *
 * `requireAuth` / `requireRole` are the module's public surface for other
 * modules; nothing else here is imported across the boundary.
 */
import type { AppModule } from '../../shared/types/module.js';
import { authRouter } from './auth.router.js';

export { requireAuth, requireRole } from './auth.middleware.js';
export type { AuthUser, RoleName } from './auth.types.js';

export const authModule: AppModule = {
  name: 'auth',
  basePath: '/auth',
  description: 'Local account registration, JWT sessions and role-based access control',
  router: authRouter,
};
