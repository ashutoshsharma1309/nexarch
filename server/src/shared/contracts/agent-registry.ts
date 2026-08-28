/**
 * The agent declarations the orchestrator plans runs from.
 *
 * Data, not behaviour: nothing here executes. The orchestrator reads these
 * to build the execution DAG, decide what is READY, and size budgets — so
 * adding an agent is a matter of declaring it and registering an
 * implementation, never of editing the scheduler.
 *
 * The mesh is eight agents deep, and the ordering is the point: each
 * answers a question the next one depends on.
 *
 *   Requirement Analyst  — what was asked for?
 *   Product Architect    — what should the product contain?
 *   Architecture Agent   — how will it be built?
 *   Database Architect   — what does the data look like?
 *   API Architect        — what is the contract between the parts?
 *   Backend Engineer     — what implements that contract?
 *   Frontend Engineer    — what does a person use?
 *   UX/UI Engineer       — is what they use any good?
 *   Security Engineer    — can it be attacked?
 *   Dependency Engineer  — does it need everything it asks for?
 *   Code Quality Eng.    — is it the system that was planned?
 *
 * The last three read and never write, which is why they share a single
 * dependency and no ordering between them.
 *
 * The last one is not a generator and its dependencies say so: it requires
 * the frontend it is reviewing, so it can never run first and can never be
 * mistaken for a second frontend agent.
 *
 * Timeouts and retries reflect what each agent actually does. An agent
 * talking to a provider over a network gets two retries; deterministic
 * code gets none, because a generator that threw will throw again on
 * identical input and retrying only delays the report.
 */
import type { AgentDefinition, RetryPolicy } from './agent.js';

const NETWORK_RETRY: RetryPolicy = {
  maxRetries: 2,
  backoffMs: 800,
  retryableKinds: ['provider-error', 'timeout', 'network', 'rate-limit'],
};

/**
 * Invalid model output is worth one more attempt — a schema miss is often
 * a one-off, and the retry costs a call rather than the whole run.
 */
const REASONING_RETRY: RetryPolicy = {
  maxRetries: 2,
  backoffMs: 800,
  retryableKinds: ['provider-error', 'timeout', 'network', 'rate-limit', 'invalid-output'],
};

const NO_RETRY: RetryPolicy = { maxRetries: 0, backoffMs: 0, retryableKinds: [] };

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    id: 'requirement-analyst',
    name: 'Requirement Analyst',
    role: 'Turns a natural-language request into a precise specification',
    description:
      'Extracts goal, actors, functional and non-functional requirements, constraints and acceptance criteria. Falls back to the rule-based analyzer when no model is reachable.',
    version: '2.0.0',
    requires: [],
    produces: ['requirement-spec'],
    dependencies: [],
    // Runs first, from the prompt; there is no graph yet to select from.
    requiredContext: null,
    executionMode: 'ai',
    timeoutMs: 60_000,
    retryPolicy: REASONING_RETRY,
    mutates: ['REQUIREMENT', 'PROJECT'],
    enabled: true,
  },
  {
    id: 'product-architect',
    name: 'Product Architect',
    role: 'Decides what the product should contain',
    description:
      'Turns requirements into modules, user journeys, screens and business rules — the product shape, before any technical decision.',
    version: '1.0.0',
    requires: ['requirement-spec'],
    produces: ['product-spec'],
    dependencies: ['requirement-analyst'],
    requiredContext: 'PRODUCT_PLANNING',
    executionMode: 'ai',
    timeoutMs: 90_000,
    retryPolicy: REASONING_RETRY,
    mutates: ['FEATURE', 'COMPONENT'],
    enabled: true,
  },
  {
    id: 'architecture-agent',
    name: 'Architecture Agent',
    role: 'Determines the technical architecture',
    description:
      'Plans services, modules, technology choices and communication patterns, with the entity model designed by one model call.',
    version: '2.0.0',
    requires: ['requirement-spec', 'product-spec'],
    produces: ['architecture-plan'],
    dependencies: ['product-architect'],
    requiredContext: 'ARCHITECTURE_PLANNING',
    executionMode: 'ai',
    timeoutMs: 60_000,
    retryPolicy: NETWORK_RETRY,
    mutates: ['FEATURE', 'SERVICE', 'MODULE', 'COMPONENT'],
    enabled: true,
  },
  {
    id: 'database-architect',
    name: 'Database Architect',
    role: 'Designs the schema from the requirements and architecture',
    description:
      'Derives tables, columns, keys, relationships and indexes. Deterministic and self-checking; no model call needed.',
    version: '2.0.0',
    requires: ['architecture-plan', 'requirement-spec'],
    produces: ['database-design'],
    dependencies: ['architecture-agent'],
    requiredContext: 'DATABASE_DESIGN',
    executionMode: 'deterministic',
    timeoutMs: 30_000,
    retryPolicy: NO_RETRY,
    mutates: ['ENTITY', 'FIELD'],
    enabled: true,
  },
  {
    id: 'api-architect',
    name: 'API Architect',
    role: 'Designs the API contract between the parts',
    description:
      'Derives the endpoint surface from the architecture and the schema, and checks the three specs agree with one another.',
    version: '1.0.0',
    // Both, and the orchestrator enforces it: an API designed without the
    // schema would name entities that do not exist.
    requires: ['architecture-plan', 'database-design'],
    produces: ['api-contract'],
    dependencies: ['architecture-agent', 'database-architect'],
    requiredContext: 'BACKEND_GENERATION',
    executionMode: 'deterministic',
    timeoutMs: 30_000,
    retryPolicy: NO_RETRY,
    mutates: ['API'],
    enabled: true,
  },

  /* ── Declared for later phases; not implemented, not enabled ────────── */

  {
    id: 'backend-engineer',
    name: 'Backend Engineer',
    role: 'Implements the API contract as a running backend',
    description:
      'Emits controllers, services, repositories, routes, middleware and configuration from the architecture, schema and API contract. Reports a finding rather than silently departing from any of the three.',
    version: '2.0.0',
    requires: ['requirement-spec', 'architecture-plan', 'database-design', 'api-contract'],
    produces: ['backend-source', 'backend-config', 'backend-metadata'],
    dependencies: ['api-architect'],
    requiredContext: 'BACKEND_GENERATION',
    executionMode: 'deterministic',
    timeoutMs: 90_000,
    retryPolicy: NO_RETRY,
    mutates: ['MODULE', 'SERVICE', 'FILE', 'TEST'],
    enabled: true,
  },
  {
    id: 'frontend-engineer',
    name: 'Frontend Engineer',
    role: 'Builds the interface against the real API contract',
    description:
      'Emits pages, components, layouts, routing, API clients, forms and state from the product spec and API contract. Every call it generates is checked against a declared endpoint.',
    version: '2.0.0',
    requires: [
      'requirement-spec',
      'product-spec',
      'architecture-plan',
      'api-contract',
      'backend-metadata',
    ],
    produces: ['frontend-source', 'frontend-config', 'frontend-metadata'],
    dependencies: ['backend-engineer'],
    requiredContext: 'FRONTEND_GENERATION',
    executionMode: 'deterministic',
    timeoutMs: 90_000,
    retryPolicy: NO_RETRY,
    mutates: ['COMPONENT', 'FILE'],
    enabled: true,
  },
  {
    id: 'ux-ui-engineer',
    name: 'UX/UI Engineer',
    role: 'Reviews the generated interface and improves it in place',
    description:
      'Reads the emitted screens for hierarchy, state handling, forms, responsiveness and accessibility, then applies targeted edits. It reviews the frontend it is given; it does not generate a second one.',
    version: '1.0.0',
    requires: ['requirement-spec', 'product-spec', 'frontend-source', 'frontend-metadata'],
    produces: ['ux-review', 'ux-improvements'],
    // It edits the frontend it reviewed; the frontend engineer still owns it.
    revises: ['frontend-source'],
    dependencies: ['frontend-engineer'],
    requiredContext: 'UX_REVIEW',
    // Its checks are code, but its reading of a user journey is not. The
    // model pass is optional and the agent degrades to checks alone, which
    // is why a reasoning retry policy applies to a mostly-deterministic agent.
    executionMode: 'ai',
    timeoutMs: 90_000,
    retryPolicy: REASONING_RETRY,
    mutates: ['COMPONENT', 'FILE'],
    enabled: true,
  },
  /*
   * The review mesh.
   *
   * All three depend on the frontend engineer and on nothing else, which
   * makes them one wave of the DAG rather than a chain. That is the point:
   * they read the same generated project and write nothing back to it, so
   * there is no order between them to get right.
   *
   * `mutates: []` is the declaration that says so, and the scheduler reads
   * it — an agent that mutates nothing is safe to run alongside its peers.
   * A review agent that ever needed to change a file would have to stop
   * being a review agent first.
   */
  {
    id: 'security-engineer',
    name: 'Security Engineer',
    role: 'Reviews the generated application for security weaknesses',
    description:
      'Runs the design-level security audit over the plan and a deterministic scan over the generated source: secrets, injection, configuration, cookies and unguarded routers. Reports; never hardens.',
    version: '2.0.0',
    requires: [
      'requirement-spec',
      'architecture-plan',
      'database-design',
      'api-contract',
      'backend-source',
      'backend-metadata',
      'frontend-source',
      'frontend-metadata',
    ],
    produces: ['security-report'],
    dependencies: ['frontend-engineer'],
    requiredContext: 'SECURITY_REVIEW',
    executionMode: 'deterministic',
    timeoutMs: 60_000,
    retryPolicy: NO_RETRY,
    // Reviews read. This is the isolation guarantee, in the declaration.
    mutates: [],
    enabled: true,
  },
  {
    id: 'dependency-engineer',
    name: 'Dependency Engineer',
    role: 'Reviews what the project depends on against what it uses',
    description:
      'Compares each package manifest to the imports in its source: unused, undeclared, duplicated, drifting, and packages on the wrong side of the client/server boundary. States plainly that known-CVE data was not consulted.',
    version: '1.0.0',
    requires: ['backend-config', 'backend-source', 'frontend-config', 'frontend-source'],
    produces: ['dependency-report'],
    dependencies: ['frontend-engineer'],
    requiredContext: 'DEPENDENCY_REVIEW',
    executionMode: 'deterministic',
    timeoutMs: 45_000,
    retryPolicy: NO_RETRY,
    mutates: [],
    enabled: true,
  },
  {
    id: 'code-quality-engineer',
    name: 'Code Quality Engineer',
    role: 'Reviews the generated source against the plan that asked for it',
    description:
      'Measures duplication, complexity, file size and dead code, then checks the code against the architecture and API contract: planned modules with no implementation, declared endpoints nothing serves, discarded errors.',
    version: '1.0.0',
    requires: [
      'requirement-spec',
      'architecture-plan',
      'api-contract',
      'backend-source',
      'backend-metadata',
      'frontend-source',
    ],
    produces: ['quality-report'],
    dependencies: ['frontend-engineer'],
    requiredContext: 'QUALITY_REVIEW',
    executionMode: 'deterministic',
    timeoutMs: 60_000,
    retryPolicy: NO_RETRY,
    mutates: [],
    enabled: true,
  },
  /*
   * The validation mesh.
   *
   * A strict chain, not a wave, and the order is Step 24's: nothing about
   * integration is worth checking before the project runs, and nothing
   * about behaviour is worth testing before the parts are known to fit.
   * All three read the project and write only their own reports — but the
   * runtime engineer executes for minutes, so the chain also keeps the
   * expensive step from running more than once.
   *
   * Timeouts are sized to reality: `npm install` on a generated project is
   * 60–120 seconds before a single check has run.
   */
  {
    id: 'runtime-engineer',
    name: 'Runtime Engineer',
    role: 'Determines whether the generated project actually builds and runs',
    description:
      'Materializes the project through the existing Local Run Engine, runs its own build/typecheck/lint scripts, verifies startup, ports and health, and scans the runtime logs. Reports exit codes and status lines, never a model’s opinion.',
    version: '1.0.0',
    requires: [
      'requirement-spec',
      'backend-source',
      'backend-config',
      'frontend-source',
      'frontend-config',
    ],
    produces: ['runtime-report'],
    dependencies: ['ux-ui-engineer'],
    // Deterministic through and through: commands, exit codes, ports.
    requiredContext: null,
    executionMode: 'deterministic',
    timeoutMs: 480_000,
    retryPolicy: NO_RETRY,
    mutates: [],
    enabled: true,
  },
  {
    id: 'integration-engineer',
    name: 'Integration Engineer',
    role: 'Verifies that the running parts actually fit together',
    description:
      'Probes every declared endpoint against the live application, exercises the authentication flow with disposable credentials, and checks database connectivity through the app itself. A contract is validated by calling it, not by re-reading it.',
    version: '1.0.0',
    requires: ['requirement-spec', 'api-contract', 'backend-metadata', 'runtime-report'],
    produces: ['integration-report'],
    dependencies: ['runtime-engineer'],
    requiredContext: null,
    executionMode: 'deterministic',
    timeoutMs: 90_000,
    retryPolicy: NO_RETRY,
    mutates: [],
    enabled: true,
  },
  {
    id: 'test-engineer',
    name: 'Test Engineer',
    role: 'Designs and executes tests against the running application',
    description:
      'Derives a bounded test plan from the product’s own priorities — auth flow, CRUD per implemented module, validation, authorization, one end-to-end path — and executes it over HTTP with disposable data. The model may reprioritize the plan; it never touches a result.',
    version: '2.0.0',
    requires: [
      'requirement-spec',
      'product-spec',
      'api-contract',
      'backend-metadata',
      'runtime-report',
      'integration-report',
    ],
    produces: ['test-report'],
    dependencies: ['integration-engineer'],
    requiredContext: 'TEST_PLANNING',
    executionMode: 'ai',
    timeoutMs: 180_000,
    retryPolicy: NO_RETRY,
    mutates: [],
    enabled: true,
  },
  /*
   * The repair engineer.
   *
   * Declared but never part of a generation run's DAG — `enabled: false`
   * is what keeps it out. Repair is not a pipeline stage: it runs after
   * validation, per finding, under a budget, driven by the repair engine
   * — which invokes this agent through the same executor every other
   * agent uses, so timeouts, retries and output validation still apply.
   *
   * `mutates` names FILE deliberately. This is the one agent whose whole
   * purpose is changing project files, and the declaration keeps it out
   * of any read-only concurrency wave forever.
   */
  {
    id: 'repair-engineer',
    name: 'Repair Engineer',
    role: 'Applies the smallest change a validated repair plan calls for',
    description:
      'Receives one finding, its root cause and a plan naming the only files it may touch. Applies deterministic strategies where the evidence is mechanical, a tightly-scoped model edit where it is not. Never decides what the application should look like.',
    version: '1.0.0',
    requires: [],
    produces: [],
    dependencies: [],
    requiredContext: 'REPAIR',
    executionMode: 'ai',
    timeoutMs: 60_000,
    retryPolicy: NO_RETRY,
    mutates: ['FILE'],
    enabled: false,
  },
  {
    id: 'dependency-analyst',
    name: 'Dependency Analyst',
    role: 'Builds the graph of what the generated project depends on',
    description: 'Currently the pipeline’s dependency stage.',
    version: '1.0.0',
    requires: ['backend-source', 'frontend-source', 'security-report'],
    produces: ['dependency-graph'],
    dependencies: ['security-engineer'],
    requiredContext: null,
    executionMode: 'deterministic',
    timeoutMs: 45_000,
    retryPolicy: NO_RETRY,
    mutates: ['DEPENDENCY'],
    enabled: false,
  },
];

export function getAgentDefinition(id: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((definition) => definition.id === id);
}
