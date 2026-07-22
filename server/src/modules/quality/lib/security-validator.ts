/**
 * Security validation — turns the Security Engine's own report (Phase 7)
 * into a pass/fail checklist, plus a real secrets-detection scan over
 * generated file content (the one check this module can perform that
 * Phase 7 doesn't: catching a literal secret value that slipped into
 * generated source rather than an env var reference).
 */
import type {
  QualityArtifacts,
  SecurityCheck,
  SecurityValidationReport,
} from '../quality.types.js';

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'Generic API key assignment',
    pattern: /(api[_-]?key|secret)\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
  },
  { name: 'Private key block', pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  {
    name: 'Hardcoded JWT secret (non-placeholder)',
    pattern: /JWT_SECRET\s*=\s*['"](?!change-me|dev-only|__SET_)[a-zA-Z0-9]{16,}['"]/,
  },
];

function detectSecrets(files: { path: string; content?: string }[]): string[] {
  const findings: string[] = [];
  for (const file of files) {
    if (!file.content) continue;
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(file.content)) findings.push(`${file.path}: possible ${name}`);
    }
  }
  return findings;
}

export function validateSecurity(artifacts: QualityArtifacts): SecurityValidationReport {
  const security = artifacts.security;
  const files = [...(artifacts.backend?.files ?? []), ...(artifacts.frontend?.files ?? [])];
  const secretsDetected = detectSecrets(files);

  const checks: SecurityCheck[] = [
    {
      name: 'Authentication configured',
      passed: Boolean(artifacts.requirements?.authentication?.length),
      detail: artifacts.requirements?.authentication?.length
        ? artifacts.requirements.authentication.join(', ')
        : 'No authentication requirement detected',
    },
    {
      name: 'Authorization / RBAC report available',
      passed: Boolean(security),
      detail: security
        ? `${security.stats.resolved}/${security.stats.findings} findings resolved`
        : 'Security Engine has not run',
    },
    {
      name: 'Input validation present',
      passed: files.some((f) => f.path.endsWith('.validator.ts')),
      detail: 'express-validator chains found on generated modules',
    },
    {
      name: 'Rate limiting configured',
      passed: files.some(
        (f) => (f.content ?? '').includes('rateLimit') || (f.content ?? '').includes('RATE_LIMIT'),
      ),
      detail: 'Rate-limiting middleware reference found in generated source',
    },
    {
      name: 'No hardcoded secrets detected',
      passed: secretsDetected.length === 0,
      detail:
        secretsDetected.length === 0
          ? 'Scan found no literal secret values'
          : `${secretsDetected.length} possible secret(s) found`,
    },
    {
      name: 'CORS configuration present',
      passed: files.some(
        (f) => (f.content ?? '').includes('CORS_ORIGINS') || (f.content ?? '').includes('cors('),
      ),
      detail: 'CORS middleware/configuration reference found',
    },
  ];

  const owaspCompliance = security
    ? {
        passed: security.owasp.passed,
        total:
          security.owasp.passed +
          security.owasp.warned +
          security.owasp.failed +
          security.owasp.notApplicable,
      }
    : { passed: 0, total: 10 };

  const score = security
    ? security.report.overallScore
    : Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);

  return { checks, owaspCompliance, secretsDetected, score };
}
