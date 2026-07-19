/**
 * Security Planner: the concrete security posture for the generated
 * application, derived from the auth requirements, role count and domain
 * sensitivity. The Security Engine stage enforces this plan; here it is
 * specified.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { SecurityPlan } from '../architecture.types.js';
import { REGULATED_TYPES } from './common.js';

export function planSecurity(spec: RequirementSpec): SecurityPlan {
  const regulated = REGULATED_TYPES.has(spec.projectType);
  const authentication =
    spec.authentication.length > 0 ? [...spec.authentication] : ['JWT', 'Email Login'];
  if (regulated && !authentication.includes('OTP')) {
    authentication.push('OTP (recommended for this domain)');
  }

  const passwordPolicy = [
    'bcrypt hashing, cost factor 12',
    `Minimum length ${regulated ? 12 : 10}, checked against a breached-password list`,
    'Reset tokens single-use, 30-minute expiry',
  ];
  if (regulated) passwordPolicy.push('Rotation prompt on suspicious sign-in patterns');

  return {
    authentication,
    sessionStrategy:
      'Stateless: 15-minute access JWT + 7-day rotating refresh token (httpOnly cookie); refresh reuse detection revokes the family',
    authorization: `RBAC — roles (${spec.roles.join(', ')}) enforced by route guards; ownership checks in services for row-level access`,
    passwordPolicy,
    rateLimiting: [
      'Global: 100 req/min per IP',
      'Auth endpoints: 10 req/min per IP + per-account lockout with backoff',
      ...(spec.authentication.includes('OTP')
        ? ['OTP verification: 5 attempts per challenge']
        : []),
    ],
    validation:
      'Every request body/query validated against DTOs at the boundary; unknown fields stripped; 422 with field-level errors',
    headers: [
      'Helmet defaults (no-sniff, frame denial, referrer policy)',
      'Strict CSP on served pages',
      'HSTS in production',
    ],
    cors: 'Explicit origin allow-list from configuration; credentials only for the app origin; deny by default',
  };
}
