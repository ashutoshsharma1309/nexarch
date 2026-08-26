/**
 * Express request augmentation.
 *
 * `req.id` is assigned by the request-context middleware for every request
 * and echoed in the `X-Request-Id` response header and error envelopes, so a
 * client-reported failure can be joined against server logs.
 *
 * `req.user` is populated by the auth module's `requireAuth`; it is present
 * only on routes that mounted that guard, which is why it stays optional.
 */
import type { AuthUser } from '../../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id (UUID v4) assigned at the edge of the pipeline. */
      id: string;
      /** The authenticated caller — set by `requireAuth`, absent on public routes. */
      user?: AuthUser;
    }
  }
}

export {};
