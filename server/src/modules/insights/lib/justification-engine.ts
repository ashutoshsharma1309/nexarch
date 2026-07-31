/**
 * Answers the questions a reviewing engineer asks first — "Why React?",
 * "Why MySQL?", "Why JWT?" — from the ArchitectureDecisions the planner
 * already recorded. The planner's reasoning and rejected alternatives are
 * quoted verbatim; this engine only frames them and adds the cross-cutting
 * infrastructure rationale (Express, Docker) the decisions block implies
 * but does not spell out.
 */
import type { ArchitectureDecision, ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { TechnologyJustification } from '../insights.types.js';

function fromDecision(
  question: string,
  layer: TechnologyJustification['layer'],
  decision: ArchitectureDecision,
): TechnologyJustification {
  return {
    question,
    technology: decision.choice,
    layer,
    reasoning: decision.reasoning,
    alternatives: decision.alternatives,
  };
}

export function buildJustifications(
  spec: RequirementSpec,
  plan: ArchitecturePlan,
): TechnologyJustification[] {
  const { decisions } = plan;

  const justifications: TechnologyJustification[] = [
    fromDecision('Why this architecture?', 'infrastructure', decisions.architecture),
    fromDecision(
      `Why ${decisions.frontendArchitecture.choice.split(' ')[0] ?? 'this frontend'}?`,
      'frontend',
      decisions.frontendArchitecture,
    ),
    fromDecision(
      `Why ${decisions.backendArchitecture.choice.split(' ')[0] ?? 'this backend'}?`,
      'backend',
      decisions.backendArchitecture,
    ),
    fromDecision(`Why ${plan.database.engine}?`, 'database', decisions.database),
    fromDecision('Why this authentication model?', 'authentication', decisions.authentication),
  ];

  // Infrastructure rationale the decision block implies but never states —
  // containerization is a generator-level default, so the reasoning lives here.
  justifications.push({
    question: 'Why Docker?',
    technology: 'Docker + Docker Compose',
    layer: 'infrastructure',
    reasoning:
      `Every generated project ships with multi-stage Dockerfiles and a Compose stack so "${spec.projectName}" ` +
      'runs identically on a laptop and a server: the database, API, and frontend versions are pinned in ' +
      'images rather than depending on host machine state, and one command produces the whole environment.',
    alternatives: [
      {
        option: 'Bare-metal process management',
        rejectedBecause:
          'reproducing the MySQL + Node + nginx environment by hand on every machine invites drift.',
      },
      {
        option: 'Serverless-only packaging',
        rejectedBecause:
          'a relational database plus a long-lived Express process fits containers better than function cold-starts.',
      },
    ],
  });

  return justifications;
}
