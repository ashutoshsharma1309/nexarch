/**
 * Scalability Planner + non-functional scoring. Recommendations are
 * strictly conditional — a portfolio site gets no Redis sermon — and every
 * one names the trigger at which the investment becomes worthwhile.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { NonFunctionalReport, ScalabilityRecommendation } from '../architecture.types.js';
import { hasIntegration, hasModule, PUBLIC_FACING_TYPES, REGULATED_TYPES } from './common.js';

export function planScalability(spec: RequirementSpec): ScalabilityRecommendation[] {
  const recommendations: ScalabilityRecommendation[] = [
    {
      concern: 'Deployment',
      recommendation:
        'Docker images (multi-stage, non-root) behind nginx; docker-compose now, orchestrator later',
      trigger: 'From day one — already the platform default',
    },
  ];

  if (hasIntegration(spec, 'Real-time')) {
    recommendations.push({
      concern: 'Real-time fan-out',
      recommendation: 'Socket.io with the Redis adapter so events reach clients on any instance',
      trigger: 'The moment a second app instance runs',
    });
  }
  if (
    hasIntegration(spec, 'Email') ||
    hasIntegration(spec, 'SMS') ||
    hasIntegration(spec, 'Notifications')
  ) {
    recommendations.push({
      concern: 'Outbound messaging',
      recommendation:
        'Background job queue (BullMQ + Redis) for email/SMS/push — never send on the request path',
      trigger: 'First production deployment',
    });
  }
  if (hasIntegration(spec, 'Payment Gateway')) {
    recommendations.push({
      concern: 'Payment reliability',
      recommendation:
        'Idempotency keys on checkout; webhook processing through a persistent queue with retries',
      trigger: 'Before accepting the first real payment',
    });
  }
  if (hasIntegration(spec, 'File Upload') || hasIntegration(spec, 'Cloud Storage')) {
    recommendations.push({
      concern: 'File storage',
      recommendation:
        'S3-compatible object storage with pre-signed upload URLs; never store files on app disks',
      trigger: 'From the first upload feature',
    });
  }
  if (hasModule(spec, 'Reports') || hasModule(spec, 'Analytics')) {
    recommendations.push({
      concern: 'Read-heavy aggregates',
      recommendation:
        'Redis cache for dashboard aggregates with short TTL; move to read replicas if cache hit rates fall',
      trigger: 'When dashboard queries exceed ~100ms p95',
    });
  }
  if (PUBLIC_FACING_TYPES.has(spec.projectType)) {
    recommendations.push({
      concern: 'Public asset delivery',
      recommendation: 'CDN in front of the static client and media assets',
      trigger: 'When serving users beyond one region',
    });
  }
  if (spec.database.length >= 8) {
    recommendations.push({
      concern: 'Search',
      recommendation:
        'MySQL FULLTEXT indexes now; dedicated search engine (OpenSearch/Meilisearch) later',
      trigger: 'When list filtering over ~100k rows stops being instant',
    });
  }

  return recommendations;
}

export function scoreNonFunctionals(spec: RequirementSpec): NonFunctionalReport {
  const regulated = REGULATED_TYPES.has(spec.projectType);
  const realtime = hasIntegration(spec, 'Real-time');

  return {
    performance: {
      score: realtime ? 7 : 8,
      notes: realtime
        ? 'CRUD paths are index-backed; socket fan-out is the pressure point — mitigated by the Redis adapter plan.'
        : 'Index-backed CRUD with pagination everywhere; aggregate endpoints are the only heavy queries.',
    },
    maintainability: {
      score: 9,
      notes:
        'Module islands + clean layering: features are added by adding folders, and any module can be rewritten in isolation.',
    },
    security: {
      score: regulated ? 9 : 8,
      notes: regulated
        ? 'JWT+RBAC with OTP, audit logging and soft deletes planned for a regulated domain.'
        : 'JWT+RBAC, boundary validation, rate limiting and hardened headers planned from the start.',
    },
    scalability: {
      score: 8,
      notes:
        'Stateless API scales horizontally behind a load balancer; module boundaries are the microservice escape hatch.',
    },
    availability: {
      score: 7,
      notes:
        'Single-region compose deployment initially; health probes and graceful shutdown are in place for orchestration.',
    },
    reliability: {
      score: 8,
      notes:
        'Transactions on multi-table writes, queued side-effects with retries, and structured logging with correlation ids.',
    },
  };
}
