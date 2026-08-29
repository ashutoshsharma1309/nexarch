/**
 * Do the planning specs agree with one another?
 *
 * Five agents each produce a coherent artifact, and the artifacts can
 * still contradict each other: an API that references an entity the
 * schema never defined, a table for a capability the architecture has no
 * component for, a requirement nothing implements. Each agent is
 * individually right and the plan as a whole is wrong.
 *
 * Every check here is set arithmetic over canonical names. No model is
 * asked whether two specs agree — that is a comparison, not a judgement,
 * and a model would be slower, cost money, and occasionally hallucinate
 * agreement.
 *
 * Findings, never failures. A mismatch is something a person should look
 * at; deciding it invalidates the run is a policy call this layer does not
 * get to make.
 */
import { canonicalize } from '../../engineering-graph/lib/canonical.js';
import type { AgentFinding } from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign, OpenApiDocument } from '../../../shared/types/design.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

export type MismatchKind =
  | 'REQUIREMENT_PRODUCT_MISMATCH'
  | 'REQUIREMENT_ARCHITECTURE_MISMATCH'
  | 'PRODUCT_ARCHITECTURE_MISMATCH'
  | 'DATABASE_ARCHITECTURE_MISMATCH'
  | 'API_DATABASE_MISMATCH';

export interface ConsistencyInput {
  requirements?: RequirementSpec | undefined;
  product?: ProductSpec | undefined;
  architecture?: ArchitecturePlan | undefined;
  database?: DatabaseDesign | undefined;
  api?: OpenApiDocument | undefined;
}

function canonicalSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => canonicalize(value)));
}

/**
 * Two names refer to the same thing when one is a prefix of the other.
 *
 * Layers name the same concept at different specificity: the requirement
 * says "Reports", the product calls it "Report Generation", the
 * architecture has a "reports" module. Exact canonical equality flags all
 * three as mismatched, which is wrong — and a check that cries wolf trains
 * people to skip its output, which is worse than not having it.
 *
 * The trade is a narrow false negative on genuinely different names that
 * happen to share a prefix. Catching a wholly absent capability is what
 * these checks are for, and they still do.
 */
function covers(haystack: Set<string>, needle: string): boolean {
  return [...haystack].some((entry) => entry.startsWith(needle) || needle.startsWith(entry));
}

function finding(
  kind: MismatchKind,
  severity: AgentFinding['severity'],
  title: string,
  description: string,
): AgentFinding {
  return {
    severity,
    category: kind,
    title,
    description,
    targetNodeId: null,
    status: 'OPEN',
  };
}

/**
 * The resource each endpoint acts on.
 *
 * Only the first meaningful path segment, and deliberately not the schema
 * component names. An earlier version read both, and the schema names
 * produced almost nothing but noise: `UserCreate`, `AttendanceRecordUpdate`
 * and `ApiError` are request shapes and error envelopes, not entity
 * references, and no amount of prefix-stripping reliably tells them apart
 * from a real one. Sub-resources (`/courses/{id}/lessons`) are skipped for
 * the same reason — the resource is what the endpoint is *about*.
 *
 * A check that cries wolf is worse than no check, because it trains people
 * to skip the output.
 */
function apiResources(api: OpenApiDocument): Set<string> {
  const names = new Set<string>();

  for (const path of Object.keys(api.paths)) {
    for (const segment of path.split('/')) {
      // Skip the prefix, the version and any path parameter.
      if (segment === '' || segment === 'api' || segment.startsWith('{')) continue;
      if (/^v\d+$/.test(segment)) continue;
      names.add(canonicalize(segment));
      break; // The first real segment is the resource.
    }
  }

  return names;
}

export function checkConsistency(input: ConsistencyInput): AgentFinding[] {
  const findings: AgentFinding[] = [];
  const { requirements, product, architecture, database, api } = input;

  /* Requirement → Product: is every requested module in the product? */
  if (requirements && product) {
    const productModules = canonicalSet(product.modules.map((module) => module.name));
    const missing = requirements.modules.filter(
      (module) => !covers(productModules, canonicalize(module)),
    );
    if (missing.length > 0) {
      findings.push(
        finding(
          'REQUIREMENT_PRODUCT_MISMATCH',
          'MEDIUM',
          'Requested capabilities are missing from the product',
          `The requirement names ${missing.join(', ')}, but the product spec has no module for them.`,
        ),
      );
    }
  }

  /* Product → Architecture: does every product module have somewhere to live? */
  if (product && architecture) {
    const built = canonicalSet([
      ...architecture.apiModules.map((module) => module.module),
      ...architecture.services.map((service) => service.module),
      ...architecture.frontend.pages.map((page) => page.name),
      // Cross-cutting concerns — access control, rate limiting — are
      // middleware and security policy, not modules with their own service.
      ...architecture.middleware.map((entry) => entry.name),
      ...architecture.security.authentication,
      architecture.security.authorization,
    ]);
    const unbuilt = product.modules
      .map((module) => module.name)
      .filter((name) => !covers(built, canonicalize(name)));
    if (unbuilt.length > 0) {
      findings.push(
        finding(
          'PRODUCT_ARCHITECTURE_MISMATCH',
          'MEDIUM',
          'Product modules have no architectural component',
          `${unbuilt.join(', ')} appear in the product spec but nothing in the architecture implements them.`,
        ),
      );
    }
  }

  /* Requirement → Architecture, checked directly as well as through the
     product, because a module can be dropped at either hop. */
  if (requirements && architecture) {
    // Screens count. A module like "Dashboard" or "Settings" is satisfied
    // by a page, and demanding a service or an entity for it flags a
    // perfectly correct plan.
    const built = canonicalSet([
      ...architecture.apiModules.map((module) => module.module),
      ...architecture.services.map((service) => service.module),
      ...architecture.database.entities.map((entity) => entity.name),
      ...architecture.frontend.pages.map((page) => page.name),
      ...architecture.frontend.navigation.map((entry) => entry.label),
      ...architecture.middleware.map((entry) => entry.name),
      ...architecture.security.authentication,
      architecture.security.authorization,
    ]);
    const unmet = requirements.modules.filter((module) => !covers(built, canonicalize(module)));
    if (unmet.length > 0) {
      findings.push(
        finding(
          'REQUIREMENT_ARCHITECTURE_MISMATCH',
          'HIGH',
          'Requirements with no architectural capability',
          `${unmet.join(', ')} were requested but the architecture provides no component, service or entity for them.`,
        ),
      );
    }
  }

  /* Database → Architecture: every table should trace to a planned entity. */
  if (database && architecture) {
    const planned = canonicalSet(architecture.database.entities.map((entity) => entity.name));
    const unplanned = database.tables
      .map((table) => table.entity)
      .filter((entity) => !covers(planned, canonicalize(entity)));
    if (unplanned.length > 0) {
      findings.push(
        finding(
          'DATABASE_ARCHITECTURE_MISMATCH',
          'HIGH',
          'Tables with no architectural entity',
          `${unplanned.join(', ')} exist in the schema but the architecture never planned them.`,
        ),
      );
    }
  }

  /* API → Database: every entity an endpoint names must exist. This is the
     mismatch that produces a runtime 500 rather than a design debate. */
  if (api && database) {
    const tables = canonicalSet(database.tables.map((table) => table.entity));
    /**
     * Endpoints that legitimately have no table behind them: session
     * management, health probes, and derived views like reports.
     */
    const nonEntity = new Set([
      'auth',
      'login',
      'logout',
      'register',
      'refresh',
      'me',
      'session',
      'password',
      'health',
      'ready',
      'metric',
      'status',
      'report',
      'search',
      'export',
      'summary',
      'dashboard',
      'analytic',
      'admin',
      'setting',
      'api',
      'error',
      'upload',
      'file',
      'notification',
    ]);

    /**
     * Matched by prefix in either direction, not exact equality.
     *
     * The architecture names an endpoint `/attendance` while the schema
     * calls the table `AttendanceRecords` — the same concept spelled at
     * two levels of specificity. Demanding exact canonical equality flags
     * that as a mismatch, which is wrong and would train people to ignore
     * the check.
     *
     * The trade is a narrow false negative: `/users` would be accepted if
     * only `UserSessions` existed. Catching a wholly invented resource is
     * what this check is for, and it still does.
     */
    const backed = (resource: string): boolean =>
      [...tables].some((table) => table.startsWith(resource) || resource.startsWith(table));

    // Non-entity concepts are matched by prefix too: an endpoint group
    // called `reporting` is the `report` concept, and a derived view has
    // no table by definition.
    const derived = (resource: string): boolean =>
      [...nonEntity].some(
        (concept) => resource.startsWith(concept) || concept.startsWith(resource),
      );

    const dangling = [...apiResources(api)].filter((entity) => !backed(entity) && !derived(entity));
    if (dangling.length > 0) {
      findings.push(
        finding(
          'API_DATABASE_MISMATCH',
          'HIGH',
          'API references entities the schema does not define',
          `${dangling.join(', ')} appear in the API contract but there is no matching table.`,
        ),
      );
    }
  }

  return findings;
}
