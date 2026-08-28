/**
 * Centralized application configuration.
 *
 * Modules import `config` — never `process.env`. This keeps every consumer on
 * validated, typed values and makes configuration greppable: if a value isn't
 * shaped here, the application doesn't use it.
 */
import { env } from './env.js';

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',

  server: {
    port: env.PORT,
    /** Prefix for all versioned API routes. */
    apiPrefix: '/api/v1',
    /** Request body size ceiling — prompts are text; nothing should be huge. */
    bodyLimit: '1mb',
  },

  database: {
    /** True when a DATABASE_URL is set; false runs the in-memory store. */
    enabled: Boolean(env.DATABASE_URL),
    url: env.DATABASE_URL ?? '',
  },

  cors: {
    origins: env.CORS_ORIGINS,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },

  auth: {
    /** When true, every request is auto-authenticated as the built-in local user. */
    disabled: env.AUTH_DISABLED,
    // Only needed when auth is on. A dev placeholder keeps the token module
    // importable in no-auth mode; the guard below refuses to run real auth
    // without a real secret.
    jwtSecret: env.JWT_SECRET ?? 'nexarch-no-auth-mode-placeholder-secret-0000',
    accessTokenTtl: env.JWT_EXPIRES_IN,
    refreshTokenTtl: env.JWT_REFRESH_EXPIRES_IN,
  },

  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

// Turning auth back on requires a real secret — fail loudly at boot rather
// than signing tokens with the no-auth placeholder.
if (!config.auth.disabled && (env.JWT_SECRET ?? '').length < 32) {
  process.stderr.write(
    'Fatal: AUTH_DISABLED is false but JWT_SECRET is missing or too short (min 32 chars)\n',
  );
  process.exit(1);
}

export type AppConfig = typeof config;
