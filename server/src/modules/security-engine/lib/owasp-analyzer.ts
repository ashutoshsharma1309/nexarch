/**
 * Maps the scan findings and what the Security Engine actually generated
 * onto the OWASP Top 10 (2021). Categories the generator has no code-level
 * lever for (vulnerable components, CI/CD integrity) are reported
 * `not-applicable` with a recommendation for where that check belongs
 * instead of a fabricated pass.
 */
import type {
  OwaspCategoryResult,
  OwaspReport,
  SecurityFinding,
} from '../security-engine.types.js';
import type { SecurityModel } from './security-model.js';

interface CategorySpec {
  id: string;
  title: string;
  evaluate: (
    findings: SecurityFinding[],
    model: SecurityModel,
    applied: boolean,
  ) => OwaspCategoryResult;
}

function unresolvedOf(findings: SecurityFinding[], category: string): SecurityFinding[] {
  return findings.filter((f) => f.category === category && !f.resolved);
}

function idsOf(findings: SecurityFinding[]): string[] {
  return findings.map((f) => f.id);
}

const CATEGORIES: CategorySpec[] = [
  {
    id: 'A01',
    title: 'Broken Access Control',
    evaluate: (findings, model, applied) => {
      const relevant = findings.filter(
        (f) => f.category === 'authentication' || f.category === 'authorization',
      );
      const unresolved = relevant.filter((f) => !f.resolved);
      const status = unresolved.length === 0 ? 'pass' : applied ? 'warn' : 'fail';
      return {
        id: 'A01',
        title: 'Broken Access Control',
        status,
        summary:
          unresolved.length === 0
            ? `Every write endpoint requires authentication, and RBAC enforces entity-metadata.json's permissions (${model.roles.join(', ')}).`
            : `${unresolved.length} endpoint(s) or structural gap(s) still allow access without the authorization entity-metadata.json specifies.`,
        findingIds: idsOf(relevant),
      };
    },
  },
  {
    id: 'A02',
    title: 'Cryptographic Failures',
    evaluate: (findings, _model, applied) => {
      const secrets = unresolvedOf(findings, 'secrets-management');
      const status = !applied ? 'warn' : secrets.length > 0 ? 'warn' : 'pass';
      return {
        id: 'A02',
        title: 'Cryptographic Failures',
        status,
        summary: applied
          ? 'Passwords are hashed with bcrypt and tokens are signed with HS256; secrets still default to placeholders until overridden per-environment.'
          : 'No password hashing or token signing exists yet — apply() generates bcrypt hashing and JWT signing.',
        findingIds: idsOf(secrets),
      };
    },
  },
  {
    id: 'A03',
    title: 'Injection',
    evaluate: (findings, _model, applied) => ({
      id: 'A03',
      title: 'Injection',
      status: applied ? 'pass' : 'warn',
      summary: applied
        ? 'Prisma parameterizes every query (no raw SQL is generated), and request bodies pass through sanitize.ts before reaching a handler.'
        : 'Prisma already parameterizes queries; request sanitization is added by apply().',
      findingIds: idsOf(findings.filter((f) => f.category === 'input-validation')),
    }),
  },
  {
    id: 'A04',
    title: 'Insecure Design',
    evaluate: (findings, model, applied) => {
      const identityGap = findings.filter(
        (f) => f.category === 'authentication' && f.location?.includes('/auth/'),
      );
      const status = !model.authEnabled
        ? 'not-applicable'
        : applied && identityGap.length === 0
          ? 'pass'
          : 'warn';
      return {
        id: 'A04',
        title: 'Insecure Design',
        status,
        summary: !model.authEnabled
          ? 'This project has no authentication module planned.'
          : 'Password policy, RBAC, and rate limiting are generated from the design artifacts rather than left to be designed later.',
        findingIds: idsOf(identityGap),
      };
    },
  },
  {
    id: 'A05',
    title: 'Security Misconfiguration',
    evaluate: (findings, _model, applied) => {
      const cors = unresolvedOf(findings, 'cors');
      const status = !applied ? 'warn' : cors.length > 0 ? 'warn' : 'pass';
      return {
        id: 'A05',
        title: 'Security Misconfiguration',
        status,
        summary: applied
          ? 'Hardened security headers, environment validation, and request size limits are applied; CORS_ORIGINS must still be set per environment.'
          : 'apply() hardens helmet, environment validation, and CORS configuration.',
        findingIds: idsOf(cors),
      };
    },
  },
  {
    id: 'A06',
    title: 'Vulnerable and Outdated Components',
    evaluate: () => ({
      id: 'A06',
      title: 'Vulnerable and Outdated Components',
      status: 'not-applicable',
      summary:
        "Dependency freshness is a CI concern, not a code-generation one — wire `npm audit` or Dependabot into the generated project's pipeline.",
      findingIds: [],
    }),
  },
  {
    id: 'A07',
    title: 'Identification and Authentication Failures',
    evaluate: (findings, model, applied) => {
      const relevant = findings.filter((f) => f.category === 'authentication');
      const unresolved = relevant.filter((f) => !f.resolved);
      const status = !model.authEnabled
        ? 'not-applicable'
        : unresolved.length === 0
          ? 'pass'
          : applied
            ? 'warn'
            : 'fail';
      return {
        id: 'A07',
        title: 'Identification and Authentication Failures',
        status,
        summary: !model.authEnabled
          ? 'This project has no authentication module planned.'
          : unresolved.length === 0
            ? 'JWT access/refresh tokens, bcrypt password hashing, and a rate-limited login endpoint are generated and wired to a real identity table.'
            : 'Authentication is planned but incompletely wired — see the linked findings.',
        findingIds: idsOf(relevant),
      };
    },
  },
  {
    id: 'A08',
    title: 'Software and Data Integrity Failures',
    evaluate: () => ({
      id: 'A08',
      title: 'Software and Data Integrity Failures',
      status: 'not-applicable',
      summary:
        'CI/CD pipeline integrity (signed commits, verified build provenance) is outside what a backend code generator can assess.',
      findingIds: [],
    }),
  },
  {
    id: 'A09',
    title: 'Security Logging and Monitoring Failures',
    evaluate: () => ({
      id: 'A09',
      title: 'Security Logging and Monitoring Failures',
      status: 'warn',
      summary:
        'Winston logs errors and warnings, but there is no dedicated audit trail for security-relevant events (failed logins, permission denials, token refresh failures).',
      findingIds: [],
    }),
  },
  {
    id: 'A10',
    title: 'Server-Side Request Forgery (SSRF)',
    evaluate: () => ({
      id: 'A10',
      title: 'Server-Side Request Forgery (SSRF)',
      status: 'not-applicable',
      summary: 'The generated backend makes no outbound requests to user-supplied URLs.',
      findingIds: [],
    }),
  },
];

export function runOwaspAnalysis(
  findings: SecurityFinding[],
  model: SecurityModel,
  applied: boolean,
): OwaspReport {
  const categories = CATEGORIES.map((spec) => spec.evaluate(findings, model, applied));
  return {
    version: '2021',
    categories,
    passed: categories.filter((c) => c.status === 'pass').length,
    warned: categories.filter((c) => c.status === 'warn').length,
    failed: categories.filter((c) => c.status === 'fail').length,
    notApplicable: categories.filter((c) => c.status === 'not-applicable').length,
  };
}
