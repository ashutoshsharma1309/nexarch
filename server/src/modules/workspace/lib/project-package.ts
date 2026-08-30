/**
 * The NexArch Project Package — a portable, versioned snapshot of one
 * project (Steps 19–22).
 *
 * A package is what "export my project" produces and "import a project"
 * consumes: a self-describing JSON document carrying the project's
 * metadata, its latest artifacts, its engineering graph, its findings, its
 * validation summary and its repair history. It carries *state*, never
 * secrets — every value that leaves is walked through the same redactor
 * that guards the logs, because an export that leaked a credential would
 * be a worse leak than a log line: it is a file a user hands to someone
 * else.
 *
 * Import is the adversarial direction and is written that way. A package
 * arriving from outside is untrusted: its schema version is checked, its
 * artifact paths are checked for traversal, its size is bounded, and
 * nothing in it is ever executed. A malformed or hostile package is
 * rejected with a reason, not partially applied.
 */
import { redactValue } from '../../../shared/security/redact.js';
import { AppError } from '../../../shared/utils/app-error.js';
import type { ArtifactType } from '../../../shared/contracts/index.js';

export const PACKAGE_SCHEMA_VERSION = 1;

/**
 * Depth bound for redacting a package on export. Far deeper than the log
 * redactor's default because a package legitimately nests — artifact →
 * spec → module → endpoint → parameter — while still bounding a
 * pathological document. The artifacts are finite JSON, so this is only a
 * ceiling, never reached by real content.
 */
const PACKAGE_REDACT_DEPTH = 40;

/** Artifact types worth carrying in a package — state, not the whole source tree. */
const PORTABLE_ARTIFACTS: ArtifactType[] = [
  'requirement-spec',
  'product-spec',
  'architecture-plan',
  'database-design',
  'api-contract',
  'backend-metadata',
  'frontend-metadata',
  'generation-manifest',
  'engineering-review',
  'validation-summary',
];

export interface ProjectPackage {
  schemaVersion: number;
  manifest: {
    generator: string;
    exportedAt: string;
    /** A demo package is marked so an importer can label it. */
    kind: 'project' | 'demo';
  };
  project: {
    name: string;
    description: string | null;
  };
  artifacts: { type: string; version: number; summary: string | null; content: unknown }[];
  graph: {
    nodes: { type: string; canonicalName: string; name: string; metadata: unknown }[];
    edges: { from: string; relationship: string; to: string }[];
  };
  findings: unknown[];
  validation: unknown;
  repairs: unknown[];
}

export interface ExportInput {
  name: string;
  description: string | null;
  kind?: 'project' | 'demo';
  artifacts: { type: string; version: number; summary: string | null; content: unknown }[];
  graphNodes: {
    id: string;
    type: string;
    canonicalName: string;
    name: string;
    metadata: unknown;
  }[];
  graphEdges: { sourceNodeId: string; relationship: string; targetNodeId: string }[];
  findings: unknown[];
  validation: unknown;
  repairs: unknown[];
}

export function isPortableArtifact(type: string): boolean {
  return (PORTABLE_ARTIFACTS as string[]).includes(type);
}

/**
 * Builds a package from a project's live state.
 *
 * Graph edges are rewritten to reference node *canonical names* rather than
 * database ids, so a re-imported graph is self-consistent without carrying
 * ids that mean nothing in another project. Everything is redacted on the
 * way out — the one and only exit for project state.
 */
export function buildPackage(input: ExportInput): ProjectPackage {
  const nameById = new Map(input.graphNodes.map((node) => [node.id, node.canonicalName]));

  const pkg: ProjectPackage = {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    manifest: {
      generator: 'nexarch-project-package/1.0',
      exportedAt: new Date().toISOString(),
      kind: input.kind ?? 'project',
    },
    project: { name: input.name, description: input.description },
    artifacts: input.artifacts.filter((artifact) => isPortableArtifact(artifact.type)),
    graph: {
      nodes: input.graphNodes.map((node) => ({
        type: node.type,
        canonicalName: node.canonicalName,
        name: node.name,
        metadata: node.metadata,
      })),
      edges: input.graphEdges
        .map((edge) => ({
          from: nameById.get(edge.sourceNodeId) ?? '',
          relationship: edge.relationship,
          to: nameById.get(edge.targetNodeId) ?? '',
        }))
        .filter((edge) => edge.from && edge.to),
    },
    findings: input.findings,
    validation: input.validation,
    repairs: input.repairs,
  };

  // The single exit: redact the whole document before it becomes a file.
  // A package is deep — artifacts carry nested specs, schemas and route
  // trees — so it is redacted with a generous depth bound. The document is
  // finite and cycle-free (it is built from JSON artifacts), and every
  // level is still checked, so the deeper walk widens secret coverage
  // rather than weakening it; the shallow log default would instead shear
  // real structure below depth 6 into a marker string.
  return redactValue(pkg, 0, PACKAGE_REDACT_DEPTH) as ProjectPackage;
}

/* ── Import validation (Steps 22, 38) ──────────────────────────────────── */

const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACTS = 40;
const MAX_NODES = 5_000;

/** A path fragment inside a package must never traverse or absolute-escape. */
function isSafePath(value: string): boolean {
  return (
    !value.startsWith('/') &&
    !value.includes('..') &&
    !value.includes('\0') &&
    !/^[a-zA-Z]:[\\/]/.test(value) // Windows absolute
  );
}

/**
 * Validates an untrusted package and returns the trusted shape.
 *
 * Every rejection is a thrown 400 with a reason a person can act on. The
 * function reads the package but never runs anything from it, and it does
 * not trust a single field it did not check — Step 22 in code.
 */
export function validatePackage(raw: unknown): ProjectPackage {
  const asString = JSON.stringify(raw ?? null);
  if (Buffer.byteLength(asString, 'utf8') > MAX_PACKAGE_BYTES) {
    throw AppError.badRequest('The project package is too large to import');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw AppError.badRequest('The project package is not an object');
  }
  const pkg = raw as Partial<ProjectPackage>;

  if (pkg.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    throw AppError.badRequest(
      `Unsupported package schema version — this build imports v${String(PACKAGE_SCHEMA_VERSION)}`,
    );
  }
  if (!pkg.project || typeof pkg.project.name !== 'string' || pkg.project.name.trim() === '') {
    throw AppError.badRequest('The package has no project name');
  }

  const artifacts = Array.isArray(pkg.artifacts) ? pkg.artifacts : [];
  if (artifacts.length > MAX_ARTIFACTS) {
    throw AppError.badRequest('The package declares too many artifacts');
  }
  for (const artifact of artifacts) {
    if (typeof artifact.type !== 'string' || !isPortableArtifact(artifact.type)) {
      throw AppError.badRequest(`The package contains an unsupported artifact type`);
    }
    // Any path-shaped field in an artifact's files must be contained.
    const files = (artifact.content as { files?: { path?: unknown }[] } | undefined)?.files;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (typeof file.path === 'string' && !isSafePath(file.path)) {
          throw AppError.badRequest(`The package contains an unsafe file path: ${file.path}`);
        }
      }
    }
  }

  const nodes = Array.isArray(pkg.graph?.nodes) ? pkg.graph.nodes : [];
  if (nodes.length > MAX_NODES) {
    throw AppError.badRequest('The package graph is too large to import');
  }
  const nodeNames = new Set(nodes.map((node) => node.canonicalName));
  for (const edge of Array.isArray(pkg.graph?.edges) ? pkg.graph.edges : []) {
    // A dangling edge reference is not fatal — it is dropped on import —
    // but a graph that references far more than it declares is suspicious.
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      throw AppError.badRequest('The package graph has a malformed edge');
    }
  }

  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    manifest: {
      generator: typeof pkg.manifest?.generator === 'string' ? pkg.manifest.generator : 'unknown',
      exportedAt:
        typeof pkg.manifest?.exportedAt === 'string'
          ? pkg.manifest.exportedAt
          : new Date().toISOString(),
      kind: pkg.manifest?.kind === 'demo' ? 'demo' : 'project',
    },
    project: {
      name: pkg.project.name.trim().slice(0, 120),
      description:
        typeof pkg.project.description === 'string' ? pkg.project.description.slice(0, 2000) : null,
    },
    artifacts,
    graph: {
      nodes,
      edges: (Array.isArray(pkg.graph?.edges) ? pkg.graph.edges : []).filter(
        (edge) => nodeNames.has(edge.from) && nodeNames.has(edge.to),
      ),
    },
    findings: Array.isArray(pkg.findings) ? pkg.findings : [],
    validation: pkg.validation ?? null,
    repairs: Array.isArray(pkg.repairs) ? pkg.repairs : [],
  };
}
