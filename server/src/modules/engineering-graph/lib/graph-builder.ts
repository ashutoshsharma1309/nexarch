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
import { GRAPH_NODE_TYPES } from '../../../shared/contracts/engineering-graph.js';
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
import { folderTree, isConfigFile, parentFolder, resolveImports } from './file-imports.js';

/**
 * A ceiling on the file tree, so one enormous project cannot produce a graph
 * no browser can draw. Generated projects run to a few hundred files; this is
 * well clear of that, and the cap is reported rather than silently applied.
 */
const MAX_GRAPH_FILES = 1_500;

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
    metadata: {
      projectType: requirements.projectType,
      // The spec's `goal` is one sentence about the product as a whole, not
      // a capability anything implements. It describes this node, so it is
      // recorded here rather than as a REQUIREMENT no feature could ever
      // resolve by name.
      ...(requirements.goal ? { goal: requirements.goal } : {}),
    },
    sourceArtifactId: null,
  });

  /* ── Requirements: what was asked for ─────────────────────────────────
   *
   * Every list in the spec that states something the system must do or be
   * becomes a REQUIREMENT node. Three of them were covered and the rest
   * were dropped, which made the requirement layer look thinner than the
   * spec actually is — a feature, a finding or a context request had
   * nothing to point at for anything the analyst wrote outside those
   * three lists.
   *
   * `assumptions` is deliberately not here: it records what the analyst
   * took as given because the request did not say, which is a note about
   * the analysis rather than something the system must satisfy.
   *
   * `kinds` is a list because one name legitimately appears in several
   * lists — "Payments" as a module and as an integration. `node()` merges
   * metadata last-writer-wins, so a single `kind` field kept only
   * whichever list happened to be read last and silently lost the rest.
   */
  const requirementSources: { list: string[]; kind: string }[] = [
    { list: requirements.modules, kind: 'module' },
    // Who the system is for is a requirement about the system.
    { list: requirements.roles, kind: 'role' },
    { list: requirements.frontend, kind: 'frontend' },
    { list: requirements.backend, kind: 'backend' },
    { list: requirements.database, kind: 'database' },
    { list: requirements.authentication, kind: 'authentication' },
    { list: requirements.integrations, kind: 'integration' },
    // Still requirements, and the kind says where they came from: the
    // analyst added them because the domain needs them, not the prompt.
    { list: requirements.missingRequirements, kind: 'missing' },
    { list: requirements.functionalRequirements ?? [], kind: 'functional' },
    { list: requirements.nonFunctionalRequirements ?? [], kind: 'non-functional' },
    { list: requirements.constraints ?? [], kind: 'constraint' },
    { list: requirements.securityRequirements ?? [], kind: 'security' },
    { list: requirements.acceptanceCriteria ?? [], kind: 'acceptance-criterion' },
  ];
  for (const { list, kind } of requirementSources) {
    for (const item of list) {
      const node = c.node({
        type: 'REQUIREMENT',
        canonicalName: canonicalize(item),
        name: item,
        description: null,
        metadata: {
          kinds: [...new Set([...requirementKinds(c.find('REQUIREMENT', item)), kind])],
        },
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
    implementsRequirement(c, feature, module.name);

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
    implementsRequirement(c, feature, apiModule.module);

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
      // The test tests the module, not the reverse. Read the other way the
      // edge was unusable: impact analysis walks *incoming* edges to answer
      // "what breaks if this module changes", so a module that pointed at
      // its own tests never listed them, and `MODULE TESTS FILE` also
      // contradicted the import-derived edges further down, where the test
      // is always the source.
      if (isTestFile(file)) c.edge(fileNode, 'TESTS', module);
      else c.edge(module, 'GENERATES', fileNode);
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
      // Same direction as the backend manifest above: the test is the one
      // doing the testing.
      if (isTestFile(file)) c.edge(fileNode, 'TESTS', component);
      else c.edge(component, 'GENERATES', fileNode);
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

    // The report states where it saw the problem, so when that location is
    // a file the graph already holds, the link is read rather than guessed.
    // Only an exact path match counts: `location` also carries things that
    // are not files — an endpoint, "auth middleware" — and a near-miss
    // link would be worse than none.
    //
    // Direction mirrors the RBAC pair below, a rule pointing at what it
    // governs, which is also the direction that makes the finding surface
    // when impact analysis asks what a change to that file affects.
    if (finding.location !== null) {
      c.edge(rule, 'VALIDATES', c.findExact('FILE', canonicalizePath(finding.location)));
    }
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

  /* ── The project's own files, folders and imports ────────────────────
   *
   * Everything above is what the *planners* said the project would be. This
   * is what the generators actually wrote: the tree as it exists, and which
   * file imports which. Those two views disagreeing is itself a finding, so
   * they are both in the graph rather than one standing in for the other.
   *
   * Containment comes from the paths; import edges come from the source and
   * carry `evidence: 'import-statement'`, because a reader must be able to
   * tell a fact that was parsed from one that was assumed. Nothing here
   * infers a relationship from two files merely sharing a directory.
   */
  const projectFiles = (files ?? []).slice(0, MAX_GRAPH_FILES);
  if (projectFiles.length > 0) {
    for (const folder of folderTree(projectFiles.map((entry) => entry.path))) {
      const node = c.node({
        type: 'FOLDER',
        canonicalName: canonicalizePath(folder.path),
        name: folder.path.slice(folder.path.lastIndexOf('/') + 1),
        description: folder.path,
        metadata: { path: folder.path },
        sourceArtifactId: 'project-files',
      });
      const parent =
        folder.parent === null ? project : c.findExact('FOLDER', canonicalizePath(folder.parent));
      c.edge(parent, 'CONTAINS', node);
    }

    for (const entry of projectFiles) {
      const node = c.node({
        type: isTestFile(entry.path) ? 'TEST' : 'FILE',
        canonicalName: canonicalizePath(entry.path),
        name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
        description: entry.path,
        metadata: {
          path: entry.path,
          lines: entry.content.split('\n').length,
          kind: isConfigFile(entry.path) ? 'config' : 'source',
        },
        sourceArtifactId: 'project-files',
      });
      const folder = parentFolder(entry.path);
      c.edge(
        folder === null ? project : c.findExact('FOLDER', canonicalizePath(folder)),
        'CONTAINS',
        node,
      );
    }

    for (const edge of resolveImports(projectFiles)) {
      const from =
        c.findExact('FILE', canonicalizePath(edge.from)) ??
        c.findExact('TEST', canonicalizePath(edge.from));
      const to =
        c.findExact('FILE', canonicalizePath(edge.to)) ??
        c.findExact('TEST', canonicalizePath(edge.to));
      // A test importing the thing it exercises is a TESTS edge; everything
      // else a file imports, it depends on.
      c.edge(from, from?.type === 'TEST' ? 'TESTS' : 'DEPENDS_ON', to, {
        evidence: 'import-statement',
        specifier: edge.specifier,
      });
    }
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
    // Resolved before the node exists so the node can state a miss: a
    // finding whose stated target the graph cannot match looks identical to
    // one that never named a target unless the gap is written down.
    const target = findingTarget(c, finding);
    const statedTarget = finding.targetNodeId ?? '';
    const unresolvedTarget = statedTarget.length > 0 && target === undefined;

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
        ...(unresolvedTarget
          ? {
              unresolvedTargetNodeId: {
                targetNodeId: statedTarget,
                reason: 'no node in this graph has this identity',
              },
            }
          : {}),
      },
      sourceArtifactId: 'engineering-review',
    });
    c.edge(project, 'CONTAINS', node);
    if (target) c.edge(node, 'TARGETS', target);
  }

  return c.result();
}

/**
 * The node a finding is about, when the graph has one.
 *
 * `targetNodeId` is honoured first: when a review agent filled it in, it
 * said outright which node it meant, and no title or filename heuristic
 * should outvote that. It was previously ignored entirely, so a finding
 * about a requirement, an endpoint or an entity — the ones with no file to
 * fall back on — lost its target and sat under the project instead.
 *
 * It is matched as a node *identity*, not as a database id: a draft has no
 * ids yet, so a persisted id cannot resolve here. That is not a failure
 * mode to paper over — an id that matches nothing falls through to the
 * heuristics below, and the finding records the miss rather than acquiring
 * an invented link.
 *
 * Then files — FILE and TEST are keyed by path. Dependency findings name
 * their package in quotes, which is fragile-looking but is our own
 * format: the dependency reviewer writes those titles, so the contract is
 * internal and tested.
 */
function findingTarget(c: DraftCollector, finding: ReviewFindingDraft): DraftNode | undefined {
  if (finding.targetNodeId) {
    const stated = nodeByIdentity(c, finding.targetNodeId);
    if (stated) return stated;
  }
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

/**
 * The node named by a node identity: either the `TYPE::canonical-name` key
 * the collector deduplicates by, or a bare name tried against every type.
 *
 * Forms are tried before types so a weak match on an early type cannot
 * beat an exact one on a later type, and the identity is tried verbatim
 * first because several types keep structure in their key — an API node is
 * `GET /api/orders`, with the method upper-cased, and path folding would
 * destroy it. `GRAPH_NODE_TYPES` fixes the order, so a name that two types
 * both carry always resolves to the same node rather than to whichever was
 * built first.
 */
function nodeByIdentity(c: DraftCollector, identity: string): DraftNode | undefined {
  const separator = identity.indexOf('::');
  if (separator > 0) {
    const type = identity.slice(0, separator);
    const name = identity.slice(separator + 2);
    if (!isNodeType(type)) return undefined;
    return c.findExact(type, name) ?? c.find(type, name);
  }

  for (const key of [identity, canonicalizePath(identity)]) {
    for (const type of GRAPH_NODE_TYPES) {
      const node = c.findExact(type, key);
      if (node) return node;
    }
  }
  for (const type of GRAPH_NODE_TYPES) {
    const node = c.find(type, identity);
    if (node) return node;
  }
  return undefined;
}

function isNodeType(value: string): value is GraphNodeType {
  return GRAPH_NODE_TYPES.some((type) => type === value);
}

/**
 * Links a feature to the requirement it shares a canonical name with, and
 * writes down the name when there is no such requirement.
 *
 * `DraftCollector.edge` returns early when either endpoint is undefined, so
 * a name that did not resolve used to leave no trace at all: a feature that
 * implements nothing and a feature whose requirement was spelled too
 * differently to match looked identical, and the spelling gap — the one
 * thing someone could actually fix — was invisible.
 *
 * The miss goes in the node's metadata because the builder has no issue
 * channel and should not grow one for this. `GraphIssue` is a closed set of
 * structural kinds (dangling edge, orphan, cycle) and `validateGraph` runs
 * over persisted nodes with database ids, which a draft does not have; a
 * second reporting subsystem would cost more than it tells anyone.
 *
 * An edge and a recorded miss can coexist on one node, deliberately: the
 * product spec and the architecture plan name the same feature in their own
 * words, so one may resolve while the other does not. Each entry says which
 * name was looked for, so the two statements do not contradict each other.
 */
function implementsRequirement(c: DraftCollector, feature: DraftNode, name: string): void {
  const requirement = c.find('REQUIREMENT', name);
  if (requirement) {
    c.edge(feature, 'IMPLEMENTS', requirement);
    return;
  }
  feature.metadata = {
    ...feature.metadata,
    unresolvedRequirements: {
      reason: 'no REQUIREMENT node has this canonical name',
      names: [...new Set([...unresolvedRequirementNames(feature), name])],
    },
  };
}

/** The requirement names already recorded as unresolved on a node. */
function unresolvedRequirementNames(node: DraftNode): string[] {
  const recorded = node.metadata?.unresolvedRequirements;
  if (typeof recorded !== 'object' || recorded === null || !('names' in recorded)) return [];
  return asStringList(recorded.names);
}

/** The requirement kinds already recorded on a node, for accumulation. */
function requirementKinds(node: DraftNode | undefined): string[] {
  return asStringList(node?.metadata?.kinds);
}

/**
 * Metadata read back out of a node is `unknown` — it survived a round trip
 * through the database and nothing guarantees its shape — so it is narrowed
 * rather than asserted.
 */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
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
