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

  // Optional on purpose. With no DATABASE_URL the server runs in a
  // zero-setup, in-memory mode (projects, graph and run history live in
  // process memory and reset on restart). Set it — a `postgresql://` string
  // (Supabase or any Postgres) — to switch on real persistence. The schema's
  // datasource provider must match whatever is set here.
  DATABASE_URL: z
    .string()
    .regex(/^(postgresql|postgres):\/\//, 'DATABASE_URL must be a postgresql:// connection string')
    .optional()
    .or(z.literal('').transform(() => undefined)),

  // When true (the default), the API auto-authenticates every request as a
  // single built-in local user — no login, no signup. Set it to `false` to
  // turn real accounts back on (which then also needs a JWT_SECRET).
  AUTH_DISABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Whether the applications NexArch *generates* get sign-in. Off by default:
  // a generated project is a public MVP — its pages and API open with no
  // login. Set `true` to plan an Authentication module, login/register
  // pages and guarded routes into every generated app.
  GENERATED_APP_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

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

  // Consumed by the auth module to sign access and refresh tokens. Optional
  // now: with AUTH_DISABLED (the default) no tokens are issued or verified, so
  // a secret is not needed to run. Turning auth back on requires setting one
  // (min 32 chars) — enforced at boot in `config/index.ts`.
  // Empty counts as unset — compose passes `${JWT_SECRET:-}` through even
  // when login is off, and an empty string must not fail the 32-char rule.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),
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
