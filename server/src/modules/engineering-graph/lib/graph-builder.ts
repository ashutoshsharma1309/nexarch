/**
 * Artifacts in, graph out.
 *
 * Every node and edge here is *derived*, never inferred by a model. The
 * database design already states that `orders.user_id` references `users`;
 * the architecture already lists which service depends on which. Asking an
 * LLM to restate facts the artifacts assert would be slower, cost money,
 * and be occasionally wrong about something the pipeline already knows
 * exactly.
 *
 * The builder is a pure function of the artifact bundle: same artifacts,
 * same graph. That is what makes synchronization safe — it can be re-run
 * at any time and the repository diffs the result against what is stored.
 *
 * Layering, roughly top to bottom:
 *
 *   PROJECT ─contains→ REQUIREMENT   (what was asked for)
 *      └─contains→ FEATURE           (what the planner decided to build)
 *           ├─implements→ REQUIREMENT
 *           ├─exposes→ API
 *           └─implemented-by→ MODULE (generated code)
 *                ├─contains→ SERVICE ─persists→ ENTITY ─contains→ FIELD
 *                ├─generates→ FILE
 *                └─tested-by→ TEST
 *   COMPONENT ─calls→ API            (frontend to backend)
 *   ENTITY ─belongs-to→ ENTITY       (foreign keys)
 *   * ─secured-by→ SECURITY_RULE
 *   MODULE ─depends-on→ DEPENDENCY   (npm packages)
 */
import type {
  DraftEdge,
  DraftNode,
  GraphDraft,
  GraphNodeType,
  GraphRelationship,
} from '../../../shared/contracts/engineering-graph.js';
import type { PipelineArtifacts } from '../../pipeline/pipeline.types.js';
import type { ProductSpec } from '../../../shared/types/product.js';

/**
 * A bundle in progress. `requirements` is the one thing always present —
 * without it there is no project to describe.
 */
export type PartialArtifacts = Pick<PipelineArtifacts, 'requirements'> &
  Partial<Omit<PipelineArtifacts, 'requirements'>> & {
    /** The Product Architect's output, when the planning mesh produced one. */
    product?: ProductSpec;
    /** The review mesh's findings, when a review has run. */
    findings?: ReviewFindingDraft[];
  };

/**
 * The slice of a finding record the graph needs. Structural rather than
 * imported: the graph should not depend on the orchestrator's store to
 * describe a finding, only on what a finding is.
 */
export interface ReviewFindingDraft {
  id: string;
  type: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  status: string;
  confidence: number;
  agentId: string;
  targetFile: string | null;
  targetNodeId: string | null;
}
import { canonicalize, canonicalizeEndpoint, canonicalizePath, nodeKey } from './canonical.js';

/** Collects nodes and edges, dropping duplicates as they arrive. */
class DraftCollector {
  private readonly nodes = new Map<string, DraftNode>();
  private readonly edges = new Map<string, DraftEdge>();

  node(node: DraftNode): DraftNode {
    const key = nodeKey(node.type, node.canonicalName);
    const existing = this.nodes.get(key);
    if (existing) {
      // First writer wins on identity; later sources may still enrich.
      existing.metadata = { ...existing.metadata, ...node.metadata };
      if (!existing.description && node.description) existing.description = node.description;
      return existing;
    }
    const stored: DraftNode = { metadata: {}, description: null, ...node };
    this.nodes.set(key, stored);
    return stored;
  }

  /** Records an edge only when both endpoints exist — no dangling edges by construction. */
  edge(
    from: DraftNode | undefined,
    relationship: GraphRelationship,
    to: DraftNode | undefined,
    metadata: Record<string, unknown> = {},
  ): void {
    if (!from || !to) return;
    if (from.type === to.type && from.canonicalName === to.canonicalName) return; // no self-loops
    const key = `${nodeKey(from.type, from.canonicalName)}|${relationship}|${nodeKey(to.type, to.canonicalName)}`;
    if (this.edges.has(key)) return;
    this.edges.set(key, {
      from: { type: from.type, canonicalName: from.canonicalName },
      to: { type: to.type, canonicalName: to.canonicalName },
      relationship,
      metadata,
    });
  }

  find(type: GraphNodeType, name: string): DraftNode | undefined {
    return this.nodes.get(nodeKey(type, canonicalize(name)));
  }

  /**
   * Lookup by the canonical name itself, for node types keyed by
   * `canonicalizePath` — FILE, TEST, DEPENDENCY — where folding the name
   * through `canonicalize` would destroy the path being matched.
   */
  findExact(type: GraphNodeType, canonicalName: string): DraftNode | undefined {
    return this.nodes.get(nodeKey(type, canonicalName));
  }

  result(): GraphDraft {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

/** Every generated file whose path marks it as a test rather than source. */
function isTestFile(path: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/** The npm dependencies a generated `package.json` declares. */
function dependenciesOf(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ];
  } catch {
    // A package.json the generator produced should always parse; if one
    // does not, that is the file's problem, not a reason to fail the graph.
    return [];
  }
}

/**
 * Builds from whatever artifacts exist.
 *
 * A full pipeline run hands over everything at once, but the agent
 * orchestrator syncs the graph after *each* agent completes — so at that
 * point the design may exist while the backend does not. Every section
 * below is therefore guarded on its own input rather than assuming a
 * complete bundle: a partial graph of what has actually been produced is
 * exactly what a downstream agent's context request should see.
 */
export function buildGraph(artifacts: PartialArtifacts): GraphDraft {
  const c = new DraftCollector();
  const {
    requirements,
    product,
    architecture,
    design,
    backend,
    frontend,
    security,
    files,
    findings,
  } = artifacts;

  /* ── Project root ───────────────────────────────────────────────────── */
  const project = c.node({
    type: 'PROJECT',
    canonicalName: canonicalize(requirements.projectName),
    name: requirements.projectName,
    description: `${requirements.projectType} application`,
    metadata: { projectType: requirements.projectType },
    sourceArtifactId: null,
  });

  /* ── Requirements: what was asked for ───────────────────────────────── */
  const requirementSources: { list: string[]; kind: string }[] = [
    { list: requirements.modules, kind: 'module' },
    { list: requirements.authentication, kind: 'authentication' },
    { list: requirements.integrations, kind: 'integration' },
  ];
  for (const { list, kind } of requirementSources) {
    for (const item of list) {
      const node = c.node({
        type: 'REQUIREMENT',
        canonicalName: canonicalize(item),
        name: item,
        description: null,
        metadata: { kind },
        sourceArtifactId: 'requirement-spec',
      });
      c.edge(project, 'CONTAINS', node);
    }
  }

  /* ── Product: what the product should contain ───────────────────────
   *
   * Product modules become FEATURE nodes and their screens become
   * COMPONENT nodes, which is the layer the architecture then implements.
   * When no product spec exists — the legacy pipeline path — features come
   * from the architecture's API modules below, and canonicalization merges
   * the two so a project built either way has one node per feature.
   */
  for (const module of product?.modules ?? []) {
    const feature = c.node({
      type: 'FEATURE',
      canonicalName: canonicalize(module.name),
      name: module.name,
      description: module.purpose,
      metadata: { owns: module.owns, roles: module.roles, source: 'product-spec' },
      sourceArtifactId: 'product-spec',
    });
    c.edge(project, 'CONTAINS', feature);
    c.edge(feature, 'IMPLEMENTS', c.find('REQUIREMENT', module.name));

    for (const dependency of module.dependsOn) {
      c.edge(feature, 'USES', c.find('FEATURE', dependency));
    }
  }

  for (const screen of product?.screens ?? []) {
    const component = c.node({
      type: 'COMPONENT',
      canonicalName: `screen:${canonicalize(screen.name)}`,
      name: screen.name,
      description: screen.purpose,
      metadata: { module: screen.module, roles: screen.roles, source: 'product-spec' },
      sourceArtifactId: 'product-spec',
    });
    c.edge(c.find('FEATURE', screen.module), 'CONTAINS', component);
  }

  /* ── Features: what the planner decided to build ────────────────────── */
  for (const apiModule of architecture?.apiModules ?? []) {
    const feature = c.node({
      type: 'FEATURE',
      canonicalName: canonicalize(apiModule.module),
      name: apiModule.module,
      description: `${apiModule.endpoints.length} endpoints under ${apiModule.basePath}`,
      metadata: { basePath: apiModule.basePath, endpoints: apiModule.endpoints.length },
      sourceArtifactId: 'architecture-plan',
    });
    c.edge(project, 'CONTAINS', feature);

    // A feature implements the requirement it shares a canonical name with.
    // Canonicalization is what makes "Order Management" and "orders" meet.
    const requirement = c.find('REQUIREMENT', apiModule.module);
    c.edge(feature, 'IMPLEMENTS', requirement);

    /* ── APIs: the endpoints a feature exposes ────────────────────────── */
    for (const endpoint of apiModule.endpoints) {
      // `endpoint.path` is already the full route — `basePath` is the
      // module's summary of it, not a prefix to prepend.
      const api = c.node({
        type: 'API',
        canonicalName: canonicalizeEndpoint(endpoint.method, endpoint.path),
        name: `${endpoint.method} ${endpoint.path}`,
        description: endpoint.description,
        metadata: {
          method: endpoint.method,
          path: endpoint.path,
          auth: endpoint.auth,
          roles: endpoint.roles ?? [],
        },
        sourceArtifactId: 'architecture-plan',
      });
      c.edge(feature, 'EXPOSES', api);
    }
  }

  /* ── Entities and fields ────────────────────────────────────────────── */
  for (const table of design?.databaseDesign.tables ?? []) {
    const entity = c.node({
      type: 'ENTITY',
      canonicalName: canonicalize(table.entity),
      name: table.entity,
      description: table.description,
      metadata: {
        tableName: table.tableName,
        columns: table.columns.length,
        softDelete: table.softDelete,
      },
      sourceArtifactId: 'database-design',
    });
    c.edge(project, 'CONTAINS', entity);

    for (const column of table.columns) {
      const field = c.node({
        type: 'FIELD',
        // Fields are only unique within their table, so the table name is
        // part of the identity — `orders.status` is not `users.status`.
        canonicalName: `${canonicalize(table.entity)}.${canonicalizePath(column.name)}`,
        name: `${table.entity}.${column.name}`,
        description: column.description,
        metadata: {
          entity: table.entity,
          column: column.name,
          sqlType: column.sqlType,
          nullable: column.nullable,
          primaryKey: column.primaryKey,
          unique: column.unique,
          ...(column.enumValues ? { enumValues: column.enumValues } : {}),
        },
        sourceArtifactId: 'database-design',
      });
      c.edge(entity, 'CONTAINS', field);

      // A foreign key is a stated relationship — read it, don't guess it.
      if (column.references) {
        const parent = c.find('ENTITY', column.references.table);
        c.edge(entity, 'BELONGS_TO', parent, {
          foreignKey: column.name,
          onDelete: column.references.onDelete,
        });
      }
    }
  }

  /* ── Modules and services: the generated backend ────────────────────── */
  for (const mod of backend?.modules ?? []) {
    const module = c.node({
      type: 'MODULE',
      canonicalName: canonicalize(mod.name),
      name: mod.name,
      description: `${mod.endpoints} endpoints${mod.crud ? ', full CRUD' : ''}`,
      metadata: { entity: mod.entity, crud: mod.crud, endpoints: mod.endpoints },
      sourceArtifactId: 'backend-source',
    });
    c.edge(project, 'CONTAINS', module);
    c.edge(module, 'IMPLEMENTS', c.find('FEATURE', mod.name));

    const service = c.node({
      type: 'SERVICE',
      canonicalName: canonicalize(mod.service),
      name: mod.service,
      description: `Business logic for ${mod.name}`,
      metadata: { controller: mod.controller, repository: mod.repository },
      sourceArtifactId: 'backend-source',
    });
    c.edge(module, 'CONTAINS', service);

    // The module names the entity it persists; the designer named the entity.
    if (mod.entity) c.edge(service, 'PERSISTS', c.find('ENTITY', mod.entity));

    // Each of this feature's endpoints is handled by this service. Without
    // this edge an endpoint is a traversal dead-end, and the chain the
    // graph exists to answer — page -> endpoint -> service -> entity —
    // breaks at its second hop.
    for (const api of apisOfFeature(c, c.find('FEATURE', mod.name))) {
      c.edge(api, 'USES', service);
    }

    for (const file of mod.files) {
      const fileNode = c.node({
        type: isTestFile(file) ? 'TEST' : 'FILE',
        canonicalName: canonicalizePath(`backend/${file}`),
        name: `backend/${file}`,
        description: null,
        metadata: { side: 'backend', path: file },
        sourceArtifactId: 'backend-source',
      });
      c.edge(module, isTestFile(file) ? 'TESTS' : 'GENERATES', fileNode);
    }
  }

  // Service-to-service coupling, as the architecture states it.
  for (const edge of architecture?.dependencyGraph.edges ?? []) {
    const from = c.find('SERVICE', edge.from) ?? c.find('MODULE', edge.from);
    const to = c.find('SERVICE', edge.to) ?? c.find('MODULE', edge.to);
    c.edge(from, 'USES', to, { reason: edge.reason });
  }

  /* ── Components: the generated frontend ─────────────────────────────── */
  for (const page of frontend?.pages ?? []) {
    const component = c.node({
      type: 'COMPONENT',
      canonicalName: `page:${canonicalizePath(page.route)}`,
      name: page.name,
      description: `${page.kind} page at ${page.route}`,
      metadata: { route: page.route, kind: page.kind, entity: page.entity },
      sourceArtifactId: 'frontend-source',
    });
    c.edge(project, 'CONTAINS', component);

    // A page that edits an entity calls that entity's endpoints. Both sides
    // are already stated: the page names its entity, the module names its.
    if (page.entity) {
      const entity = c.find('ENTITY', page.entity);
      c.edge(component, 'USES', entity);
      const module = c.find('MODULE', page.entity);
      if (module) {
        const feature = c.find('FEATURE', module.name);
        for (const api of apisOfFeature(c, feature)) c.edge(component, 'CALLS', api);
      }
    }

    for (const file of page.files) {
      const fileNode = c.node({
        type: isTestFile(file) ? 'TEST' : 'FILE',
        canonicalName: canonicalizePath(`frontend/${file}`),
        name: `frontend/${file}`,
        description: null,
        metadata: { side: 'frontend', path: file },
        sourceArtifactId: 'frontend-source',
      });
      c.edge(component, isTestFile(file) ? 'TESTS' : 'GENERATES', fileNode);
    }
  }

  /* ── Security rules ─────────────────────────────────────────────────── */
  for (const finding of security?.report.findings ?? []) {
    const rule = c.node({
      type: 'SECURITY_RULE',
      canonicalName: canonicalizePath(finding.id),
      name: finding.title,
      description: finding.description,
      metadata: {
        severity: finding.severity,
        category: finding.category,
        owasp: finding.owasp,
        resolved: finding.resolved,
        location: finding.location,
      },
      sourceArtifactId: 'security-report',
    });
    c.edge(project, 'CONTAINS', rule);
  }

  // RBAC: a permission is a rule that governs one entity.
  for (const permission of security?.permissions ?? []) {
    const rule = c.node({
      type: 'SECURITY_RULE',
      canonicalName: canonicalizePath(`rbac:${permission.role}:${permission.entity}`),
      name: `${permission.role} → ${permission.entity}`,
      description: `${permission.role} may ${permission.actions.join(', ')} ${permission.entity}`,
      metadata: { role: permission.role, entity: permission.entity, actions: permission.actions },
      sourceArtifactId: 'security-report',
    });
    const entity = c.find('ENTITY', permission.entity);
    c.edge(rule, 'VALIDATES', entity);
    c.edge(entity, 'SECURED_BY', rule);
  }

  /* ── External dependencies, from the generated manifests ────────────── */
  for (const file of files ?? []) {
    if (!/^(backend|frontend)\/package\.json$/.test(file.path)) continue;
    const side = file.path.split('/')[0] ?? 'backend';
    for (const name of dependenciesOf(file.content)) {
      const dependency = c.node({
        type: 'DEPENDENCY',
        canonicalName: canonicalizePath(name),
        name,
        description: null,
        metadata: { sides: [side] },
        sourceArtifactId: 'project-files',
      });
      c.edge(project, 'DEPENDS_ON', dependency, { side });
    }
  }

  /* ── Findings: what the review mesh reported ──────────────────────────
   *
   * Each finding becomes a node so impact analysis can walk from a change
   * to the findings it might invalidate. Identity is the finding's own
   * stable id — the store already deduplicates, so the graph must not
   * re-key and risk splitting one problem into several nodes.
   *
   * The TARGETS edge is best-effort by design: a finding about a file
   * links to that file's node when one exists, a dependency finding links
   * to the package's node, and a finding about nothing the graph models
   * stays a child of the project. A guessed link would be worse than none —
   * Step 26 says no fake links, and that applies here first.
   */
  for (const finding of findings ?? []) {
    const node = c.node({
      type: 'FINDING',
      canonicalName: `finding:${finding.id}`,
      name: finding.title.length > 90 ? `${finding.title.slice(0, 87)}…` : finding.title,
      description: finding.description,
      metadata: {
        findingType: finding.type,
        severity: finding.severity,
        category: finding.category,
        status: finding.status,
        confidence: finding.confidence,
        agentId: finding.agentId,
        targetFile: finding.targetFile,
      },
      sourceArtifactId: 'engineering-review',
    });
    c.edge(project, 'CONTAINS', node);

    const target = findingTarget(c, finding);
    if (target) c.edge(node, 'TARGETS', target);
  }

  return c.result();
}

/**
 * The node a finding is about, when the graph has one.
 *
 * Files first — FILE and TEST are keyed by path. Dependency findings name
 * their package in quotes, which is fragile-looking but is our own
 * format: the dependency reviewer writes those titles, so the contract is
 * internal and tested.
 */
function findingTarget(c: DraftCollector, finding: ReviewFindingDraft): DraftNode | undefined {
  if (finding.targetFile) {
    const key = canonicalizePath(finding.targetFile);
    const file = c.findExact('FILE', key) ?? c.findExact('TEST', key);
    if (file) return file;
  }
  if (finding.type === 'DEPENDENCY') {
    const name = /"([^"]+)"/.exec(finding.title)?.[1];
    if (name) return c.findExact('DEPENDENCY', canonicalizePath(name));
  }
  return undefined;
}

/** The API nodes a feature exposes, read back out of the collector. */
function apisOfFeature(c: DraftCollector, feature: DraftNode | undefined): DraftNode[] {
  if (!feature) return [];
  const draft = c.result();
  const featureKey = nodeKey(feature.type, feature.canonicalName);
  const apiNames = draft.edges
    .filter(
      (edge) =>
        edge.relationship === 'EXPOSES' &&
        nodeKey(edge.from.type, edge.from.canonicalName) === featureKey,
    )
    .map((edge) => nodeKey(edge.to.type, edge.to.canonicalName));
  return draft.nodes.filter((node) => apiNames.includes(nodeKey(node.type, node.canonicalName)));
}
