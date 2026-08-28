/**
 * Artifact contracts (v2 foundation).
 *
 * An artifact is one meaningful output of the engineering process. The
 * platform already *produces* every one of these — the pipeline's
 * `PipelineArtifacts` bundle is exactly this set, keyed by field name. What
 * was missing is the ability to name, address and describe one artifact
 * without materializing the rest.
 *
 * That matters for exactly one reason: a v2 agent must be able to ask for
 * "the database design for run X" and receive only that. Fetching a
 * megabyte bundle to read one field is the token problem in miniature, and
 * it is why this file describes artifacts by *reference* rather than
 * carrying their content.
 *
 * Deliberately NOT introduced here: a second copy of artifact content. The
 * pipeline's run store remains the single home of generated output; an
 * `ArtifactDescriptor` points at it.
 */

export type ArtifactType =
  | 'requirement-spec'
  /** What the product should contain, before any technical decision. */
  | 'product-spec'
  | 'architecture-plan'
  | 'architecture-markdown'
  | 'database-design'
  | 'api-contract'
  | 'backend-source'
  /** Runtime configuration the backend needs but does not contain: env, schema, package manifest. */
  | 'backend-config'
  /** What the backend generation did: modules, routes, file operations. */
  | 'backend-metadata'
  | 'frontend-source'
  | 'frontend-config'
  | 'frontend-metadata'
  /** The UX engineer's structured reading of the generated interface. */
  | 'ux-review'
  /** The targeted edits that review produced, and what they changed. */
  | 'ux-improvements'
  /** Created / updated / preserved / deleted, across one generation run. */
  | 'generation-manifest'
  | 'security-report'
  /** The dependency engineer's reading of the manifests against the source. */
  | 'dependency-report'
  /** The code quality engineer's reading of the generated source. */
  | 'quality-report'
  /** All three review agents' findings, summarized and scored. Versioned per review. */
  | 'engineering-review'
  | 'dependency-graph'
  | 'project-files'
  /** What actually happened when the project was built and started. */
  | 'runtime-report'
  /** Whether the running parts fit together: contract, auth, database. */
  | 'integration-report'
  /** The executed test plan and every result, with evidence. */
  | 'test-report'
  /** The whole validation, gated: build, runtime, integration, tests. */
  | 'validation-summary';

export type ArtifactStatus = 'available' | 'pending' | 'failed';

/**
 * What an artifact *is*, without being the artifact. Small enough to list,
 * persist, and put in an agent's context window; `ref` is how a consumer
 * resolves the real thing when it actually needs it.
 */
export interface ArtifactDescriptor {
  id: string;
  projectId: string;
  runId: string;
  type: ArtifactType;
  status: ArtifactStatus;
  /** Human summary of the content, e.g. "9 tables · 61 columns". */
  summary: string | null;
  /** Facts a selector can filter on without resolving content. */
  metadata: Record<string, unknown>;
  /** Serialized size in bytes — the input to any token budget decision. */
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** Resolves a descriptor to its content. Implemented by whoever owns storage. */
export interface ArtifactResolver {
  list(runId: string): Promise<ArtifactDescriptor[]>;
  describe(runId: string, type: ArtifactType): Promise<ArtifactDescriptor | null>;
  /** Resolves to `null` when the artifact is unavailable. */
  resolve(runId: string, type: ArtifactType): Promise<unknown>;
}
