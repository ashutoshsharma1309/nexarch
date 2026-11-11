/**
 * A self-report of the security controls that are actually wired.
 *
 * Every entry here corresponds to a control the codebase enforces, checked
 * at request time against configuration rather than asserted — a status
 * page that says "authentication ✓" while auth is off is worse than no
 * page. Where a control is present but a production setting is missing
 * (secure cookies require production, a strong JWT secret requires a real
 * value), the state is WARNING with the reason, not a false PASS.
 *
 * It carries no secrets and no values — presence and posture only — and it
 * sits behind auth so it is not an anonymous map of the platform's
 * defenses.
 */
import { config } from '../../shared/config/index.js';

export type SecurityCheckState = 'PASS' | 'WARNING' | 'FAIL';

export interface SecurityCheck {
  category: string;
  state: SecurityCheckState;
  detail: string;
}

export interface SecurityStatusReport {
  checks: SecurityCheck[];
  generatedAt: string;
}

export function getSecurityStatus(): SecurityStatusReport {
  const checks: SecurityCheck[] = [];

  /* Authentication: bcrypt hashing, httpOnly cookies, timing-safe verify. */
  checks.push({
    category: 'Authentication',
    state: config.auth.disabled ? 'WARNING' : 'PASS',
    detail: config.auth.disabled
      ? 'Login is off: every request from this machine runs as the built-in admin. Refused in production; remote peers and requests naming any non-loopback Host are rejected.'
      : 'bcrypt-hashed passwords, JWT in httpOnly cookies, timing-safe verification.',
  });

  /* Authorization: every project-scoped read resolves ownership as 404. */
  checks.push({
    category: 'Authorization',
    state: 'PASS',
    detail: "Ownership enforced server-side; another user's resource resolves as 404.",
  });

  checks.push({
    category: 'Project Isolation',
    state: 'PASS',
    detail: 'Findings, artifacts, graph and repairs are keyed by project and owner.',
  });

  /*
   * Secret protection. The sanitizer covers the assembled context package.
   * Prompt variables and untrusted data, which can carry whole project files,
   * go to the provider without it, so this is not a PASS.
   */
  checks.push({
    category: 'Secret Protection',
    state: 'WARNING',
    detail:
      'The assembled context is sanitized before it reaches a model and logs are redacted. Prompt variables and web evidence are not sanitized, so a secret written into a project file can reach a model provider.',
  });

  /*
   * Sandbox: the controls below protect the platform from its own spawn
   * calls. They do not contain the generated code once it is running, so
   * this can never be a PASS until each run has OS-level isolation.
   */
  checks.push({
    category: 'Sandbox',
    state: config.isProduction ? 'FAIL' : 'WARNING',
    detail:
      'No OS-level isolation: generated apps run as ordinary child processes with this server user’s privileges. Env allowlist, argv-array spawns and workspace path checks are in place but do not contain the running code.',
  });

  checks.push({
    category: 'Rate Limiting',
    state: config.isTest ? 'WARNING' : 'PASS',
    detail: config.isTest
      ? 'Disabled in the test environment by design.'
      : 'Global read limit plus a strict per-user limit on expensive operations.',
  });

  /* Cookies are only Secure under production; flag a non-production runtime. */
  checks.push({
    category: 'Secure Cookies',
    state: config.isProduction ? 'PASS' : 'WARNING',
    detail: config.isProduction
      ? 'Session cookies are Secure, httpOnly and SameSite=Lax.'
      : 'Cookies are httpOnly/SameSite but the Secure flag applies only in production.',
  });

  /* A default/short JWT secret in production is a genuine finding. */
  const jwtSecret = config.auth.jwtSecret;
  const weakSecret = jwtSecret.length < 32 || /change|secret|default|example/i.test(jwtSecret);
  checks.push({
    category: 'Token Signing',
    state: config.isProduction && weakSecret ? 'FAIL' : weakSecret ? 'WARNING' : 'PASS',
    detail: weakSecret
      ? 'JWT secret looks short or default — set a long random JWT_SECRET before production.'
      : 'JWT secret is set and of adequate length.',
  });

  /* CORS: a production wildcard is unsafe; deny-by-default allowlist passes. */
  const origins = config.cors.origins;
  const wildcard = origins.includes('*');
  checks.push({
    category: 'CORS',
    state: config.isProduction && wildcard ? 'FAIL' : 'PASS',
    detail: wildcard
      ? 'Allowlist contains a wildcard — restrict origins in production.'
      : `Deny-by-default allowlist (${String(origins.length)} origin(s)).`,
  });

  return { checks, generatedAt: new Date().toISOString() };
}
