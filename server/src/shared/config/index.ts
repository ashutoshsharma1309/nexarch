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
    url: env.DATABASE_URL,
  },

  cors: {
    origins: env.CORS_ORIGINS,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },

  auth: {
    jwtSecret: env.JWT_SECRET,
    accessTokenTtl: env.JWT_EXPIRES_IN,
    refreshTokenTtl: env.JWT_REFRESH_EXPIRES_IN,
  },

  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

export type AppConfig = typeof config;
