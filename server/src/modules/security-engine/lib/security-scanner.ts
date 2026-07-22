/**
 * Audits the design artifacts for security gaps: open endpoints, missing
 * authorization, sensitive-data exposure, weak defaults, and structural
 * limits the Security Engine can't fix without touching the database
 * schema (which it's forbidden from doing). Every finding names the exact
 * gap and the fix that closes it; `resolved` flips to true once `apply()`
 * actually generates that fix (see `RESOLVABLE_CATEGORIES` below).
 */
import { slugify } from '../../../shared/utils/strings.js';
import type { SecurityFinding, SecuritySeverity } from '../security-engine.types.js';
import type { SecurityModel } from './security-model.js';

/** Categories `apply()` always closes by generating the corresponding file(s). */
const RESOLVABLE_CATEGORIES = new Set([
  'authentication',
  'authorization',
  'rate-limiting',
  'input-validation',
  'csrf',
  'security-headers',
  'password-policy',
  'file-upload',
]);

function finding(
  applied: boolean,
  severity: SecuritySeverity,
  category: string,
  owasp: string | null,
  title: string,
  description: string,
  location: string | null,
  recommendation: string,
): SecurityFinding {
  return {
    id: `${category}-${slugify(title, { maxLength: 60 })}`,
    severity,
    category,
    owasp,
    title,
    description,
    location,
    recommendation,
    resolved: applied && RESOLVABLE_CATEGORIES.has(category),
  };
}

function scanOpenEndpoints(model: SecurityModel, applied: boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const isPublicAuthAction = (module: string, path: string): boolean =>
    module === 'Authentication' && /register|login|refresh/i.test(path);

  for (const endpoint of model.endpoints) {
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method);
    if (!isWrite || endpoint.authRequired) continue;
    if (isPublicAuthAction(endpoint.module, endpoint.path)) continue;

    findings.push(
      finding(
        applied,
        endpoint.sensitiveData ? 'critical' : 'high',
        'authentication',
        'A01:2021 - Broken Access Control',
        `Unauthenticated write endpoint: ${endpoint.method} ${endpoint.path}`,
        `${endpoint.method} ${endpoint.path} (${endpoint.module}) accepts requests without a bearer token.`,
        `${endpoint.method} ${endpoint.path}`,
        'Require authentication (requireAuth) on every endpoint that creates, updates, or deletes data.',
      ),
    );
  }
  return findings;
}

function scanMissingAuthorization(model: SecurityModel, applied: boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const endpoint of model.endpoints) {
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method);
    if (!isWrite || !endpoint.authRequired || endpoint.rolesRequired.length > 0) continue;
    const entity = model.entities.find((e) => e.entity === endpoint.module);
    const nonUniform =
      entity && new Set(entity.permissions.map((p) => p.actions.join(','))).size > 1;
    if (!nonUniform) continue;

    findings.push(
      finding(
        applied,
        'medium',
        'authorization',
        'A01:2021 - Broken Access Control',
        `No role restriction on ${endpoint.method} ${endpoint.path}`,
        `${entity.entity} grants different roles different permissions, but this endpoint doesn't check the caller's role.`,
        `${endpoint.method} ${endpoint.path}`,
        'Add requirePermission(entity, action) so the route enforces the same permissions entity-metadata.json already defines.',
      ),
    );
  }
  return findings;
}

function scanSensitiveExposure(model: SecurityModel, applied: boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const endpoint of model.endpoints) {
    if (!endpoint.sensitiveData || endpoint.authRequired || endpoint.method !== 'GET') continue;
    findings.push(
      finding(
        applied,
        'critical',
        'sensitive-data',
        'A02:2021 - Cryptographic Failures',
        `Sensitive fields readable without authentication: ${endpoint.path}`,
        `${endpoint.method} ${endpoint.path} exposes sensitive columns to unauthenticated callers.`,
        `${endpoint.method} ${endpoint.path}`,
        'Require authentication on this route, or exclude sensitive columns from the response payload.',
      ),
    );
  }
  return findings;
}

function scanIdentity(model: SecurityModel, applied: boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!model.authEnabled) return findings;

  if (!model.identity) {
    findings.push(
      finding(
        applied,
        'high',
        'authentication',
        'A07:2021 - Identification and Authentication Failures',
        'No identity table detected for authentication',
        'The design plans authentication endpoints, but no table has both an email-shaped and a password-shaped column, so register/login cannot be wired to a persistent store.',
        '/auth/register, /auth/login',
        'Add a table with an email and password column (e.g. Users) so the Security Engine can wire real authentication against it.',
      ),
    );
    return findings;
  }

  if (!model.identity.roleField) {
    findings.push({
      ...finding(
        applied,
        'medium',
        'authorization',
        'A01:2021 - Broken Access Control',
        'Identity table has no role column',
        `${model.identity.entity} has no enum-backed role column, so every registered account is treated as the same implicit role — RBAC cannot differentiate users at runtime.`,
        model.identity.entity,
        'Add an enum-backed role column to the identity table so registered accounts carry a real, differentiable role.',
      ),
      // Structural — no role column means there is nothing for RBAC code to
      // read; this can't be closed by generating more middleware.
      resolved: false,
    });
  }

  return findings;
}

function scanConfigDefaults(applied: boolean): SecurityFinding[] {
  return [
    finding(
      applied,
      'medium',
      'secrets-management',
      'A02:2021 - Cryptographic Failures',
      'JWT/cookie secrets default to placeholder values',
      'env.ts falls back to a placeholder secret (e.g. "change-me-in-production-please") when JWT_SECRET, JWT_REFRESH_SECRET, or COOKIE_SECRET are unset, so a deploy that forgets to set them signs tokens with a known value.',
      '.env',
      'Set JWT_SECRET, JWT_REFRESH_SECRET, and COOKIE_SECRET to long random values in every deployed environment; never rely on the default.',
    ),
    finding(
      applied,
      'medium',
      'cors',
      'A05:2021 - Security Misconfiguration',
      'CORS defaults to allowing any origin',
      'CORS_ORIGINS defaults to "*", which the generated CORS middleware treats as "reflect any origin" — fine for local development, unsafe once the API is public.',
      '.env (CORS_ORIGINS)',
      'Set CORS_ORIGINS to the exact list of origins allowed to call this API before deploying.',
    ),
    finding(
      applied,
      'low',
      'transport',
      'A05:2021 - Security Misconfiguration',
      'TLS termination is not handled by this process',
      'The generated Express app serves plain HTTP; it expects a reverse proxy or load balancer in front of it to terminate TLS.',
      'deployment',
      'Deploy behind a load balancer/reverse proxy that terminates HTTPS and forwards traffic to this process over a private network.',
    ),
  ];
}

export function runSecurityScanner(model: SecurityModel, applied: boolean): SecurityFinding[] {
  return [
    ...scanIdentity(model, applied),
    ...scanOpenEndpoints(model, applied),
    ...scanMissingAuthorization(model, applied),
    ...scanSensitiveExposure(model, applied),
    ...scanConfigDefaults(applied),
  ];
}
