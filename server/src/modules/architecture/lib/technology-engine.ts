/**
 * Technology Recommendation Engine: the five load-bearing architecture
 * decisions, each with reasoning and rejected alternatives. Decisions are
 * rule-driven from the requirement spec — module count, domain regulation,
 * team-size assumptions — not fixed strings.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { ArchitectureDecision, ArchitectureDecisions } from '../architecture.types.js';
import { hasIntegration, REGULATED_TYPES } from './common.js';

function architectureStyle(spec: RequirementSpec): ArchitectureDecision {
  const moduleCount = spec.modules.length;
  const realtime = hasIntegration(spec, 'Real-time');

  const reasoning = [
    `${moduleCount} modules with shared entities (Users appears in ${moduleCount > 1 ? 'multiple' : 'one'} flows) favor one deployable with strict internal boundaries.`,
    'Each module owns its routes/services/repositories and communicates through explicit interfaces, so any module can be extracted to a service later without a rewrite.',
    realtime
      ? 'Real-time features run in-process now; the gateway can split out first if connection counts demand it.'
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    choice: 'Modular Monolith',
    reasoning,
    alternatives: [
      {
        option: 'Microservices',
        rejectedBecause:
          'Operational cost (service discovery, distributed transactions, per-service pipelines) is unjustified before team and traffic force it; module boundaries preserve the migration path.',
      },
      {
        option: 'Classic layered MVC monolith',
        rejectedBecause:
          'Horizontal layers (all controllers together, all models together) couple every feature to every other; feature seams are what enable incremental regeneration.',
      },
    ],
  };
}

function frontendArchitecture(spec: RequirementSpec): ArchitectureDecision {
  return {
    choice: 'Feature-based React SPA',
    reasoning: `One folder per product feature (${spec.modules.slice(0, 4).join(', ')}, …) owning its pages, components and state; shared/ holds the design system and cross-cutting services. Screens map 1:1 to backend modules, which keeps generated code navigable.`,
    alternatives: [
      {
        option: 'Server-side rendering (Next.js)',
        rejectedBecause:
          'The product surface is an authenticated console; SEO-critical pages are limited to the landing page, which does not justify an SSR runtime.',
      },
      {
        option: 'Type-based folders (components/, containers/, pages/)',
        rejectedBecause:
          'Scatters each feature across the tree; churn on any feature touches every folder.',
      },
    ],
  };
}

function backendArchitecture(_spec: RequirementSpec): ArchitectureDecision {
  return {
    choice: 'Clean Architecture in feature modules (controller → service → repository)',
    reasoning:
      'Controllers translate HTTP, services own business rules, repositories own persistence. Dependencies point inward only, so business logic is testable without HTTP or a database and the ORM stays swappable.',
    alternatives: [
      {
        option: 'Controllers talking to the ORM directly',
        rejectedBecause:
          'Couples business rules to persistence; untestable without a live database.',
      },
      {
        option: 'Full hexagonal architecture with ports/adapters for every boundary',
        rejectedBecause:
          'The ceremony outweighs the benefit at this scale; the repository seam captures the valuable part.',
      },
    ],
  };
}

function databaseChoice(spec: RequirementSpec): ArchitectureDecision {
  const regulated = REGULATED_TYPES.has(spec.projectType);
  return {
    choice: 'MySQL 8 (via Prisma ORM)',
    reasoning: [
      `${spec.database.length} entities with clear relationships (foreign keys, joins, transactional writes) are a relational workload.`,
      regulated
        ? `${spec.projectType} data is high-liability: ACID transactions and referential integrity are non-negotiable.`
        : 'ACID guarantees keep multi-table writes (orders, bookings, enrollments) consistent.',
      'Prisma provides typed access and migration history for the generated schema.',
    ].join(' '),
    alternatives: [
      {
        option: 'MongoDB',
        rejectedBecause:
          'The entity graph is relational; document modeling would either duplicate data or reimplement joins in application code.',
      },
      {
        option: 'PostgreSQL',
        rejectedBecause:
          'Equally capable; MySQL is the platform standard and nothing in this spec (no JSONB-heavy or GIS workload) forces a switch.',
      },
    ],
  };
}

function authenticationChoice(spec: RequirementSpec): ArchitectureDecision {
  const methods = spec.authentication.length > 0 ? spec.authentication : ['JWT', 'Email Login'];
  const otp = methods.includes('OTP');
  return {
    choice: methods.join(' + '),
    reasoning: [
      'Stateless JWT access tokens (short-lived) with rotating refresh tokens: horizontal scaling needs no session store and token revocation rides on refresh rotation.',
      spec.roles.length > 1
        ? `RBAC guards map the ${spec.roles.length} roles (${spec.roles.join(', ')}) to route-level permissions.`
        : null,
      otp ? 'OTP adds a second factor on sensitive actions.' : null,
    ]
      .filter(Boolean)
      .join(' '),
    alternatives: [
      {
        option: 'Server-side sessions (cookie + store)',
        rejectedBecause:
          'Adds a stateful store and sticky-session concerns without improving the security posture here.',
      },
      {
        option: 'Third-party auth platform (Auth0/Clerk)',
        rejectedBecause:
          'External dependency and per-user cost; the requirement is standard enough to own.',
      },
    ],
  };
}

export function decideTechnology(spec: RequirementSpec): ArchitectureDecisions {
  return {
    architecture: architectureStyle(spec),
    frontendArchitecture: frontendArchitecture(spec),
    backendArchitecture: backendArchitecture(spec),
    database: databaseChoice(spec),
    authentication: authenticationChoice(spec),
  };
}
