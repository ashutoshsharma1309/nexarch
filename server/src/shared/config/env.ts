/**
 * Environment loading and validation.
 *
 * Every variable the process reads is declared here, once. The schema is the
 * single source of truth: `.env.example` documents it for humans, this file
 * enforces it for machines. Invalid or missing configuration kills the
 * process at boot — a misconfigured server must never limp into serving
 * traffic and fail on the first request that touches the bad value.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .startsWith('mysql://', 'DATABASE_URL must be a mysql:// connection string'),

  /** Comma-separated allow-list of browser origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Validated now, consumed by the auth module in a later phase: a deploy
  // with a weak or missing secret should fail at boot, not at first login.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // The logger depends on config, so config failures report directly.
    process.stderr.write(`Fatal: invalid environment configuration\n${issues}\n`);
    process.exit(1);
  }

  return result.data;
}

export const env: Env = loadEnv();
