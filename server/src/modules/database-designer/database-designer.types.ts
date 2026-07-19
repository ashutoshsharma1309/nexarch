/**
 * Contracts for the Database Designer & API Contract Generator (Phase 4).
 *
 * The `DesignBundle` is the single source of truth every later stage reads:
 * the relational design, the emitted Prisma/SQL schemas, the ER diagram, the
 * OpenAPI 3.1 contract, field validation rules, entity metadata, and an
 * integrity report proving the design is internally consistent.
 */

/* ── Relational design ───────────────────────────────────────────────── */

export type OnDelete = 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';

export interface ForeignKeyRef {
  table: string;
  column: string;
  onDelete: OnDelete;
}

export interface ColumnDesign {
  /** snake_case physical column name. */
  name: string;
  /** camelCase Prisma field name. */
  field: string;
  /** Full MySQL type, e.g. `VARCHAR(255)`, `DECIMAL(12,2)`, `CHAR(36)`. */
  sqlType: string;
  /** Prisma scalar or enum type, e.g. `String`, `Decimal`, `OrderStatus`. */
  prismaType: string;
  /** Optional Prisma native attribute, e.g. `@db.VarChar(255)`. */
  prismaNativeType?: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  /** Present when this column is a foreign key. */
  references?: ForeignKeyRef;
  /** SQL default expression, e.g. `now()`, `false`. */
  defaultExpression?: string;
  /** Set to CURRENT_TIMESTAMP on update (the `updated_at` column). */
  onUpdateNow?: boolean;
  /** Allowed values when the column is enum-backed. */
  enumValues?: string[];
  /** Semantic format for validation/OpenAPI: `email`, `phone`, `uuid`, `date`, `uri`, `slug`. */
  format?: string;
  /** Numeric column that must be >= 0 (money, quantities). */
  nonNegative?: boolean;
  description: string;
}

export interface IndexDesign {
  name: string;
  columns: string[];
  unique: boolean;
  /** Why the index exists — surfaced in the optimization report. */
  rationale: string;
}

export interface TableDesign {
  /** PascalCase Prisma model name. */
  entity: string;
  /** snake_case physical table name. */
  tableName: string;
  columns: ColumnDesign[];
  primaryKey: string;
  indexes: IndexDesign[];
  /** True when the table carries `deleted_at` and is filtered by default. */
  softDelete: boolean;
  description: string;
}

export type RelationshipCardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface RelationshipDesign {
  name: string;
  cardinality: RelationshipCardinality;
  /** The "one" side. */
  parent: string;
  /** The "many"/owning side that holds the foreign key. */
  child: string;
  foreignKey: string;
  onDelete: OnDelete;
  description: string;
}

export interface PrismaEnumDesign {
  name: string;
  values: string[];
}

/* ── Optimization ────────────────────────────────────────────────────── */

export interface IndexRecommendation {
  table: string;
  columns: string[];
  kind: 'single' | 'composite' | 'unique';
  reason: string;
}

export interface OptimizationReport {
  indexes: IndexRecommendation[];
  cachingCandidates: { table: string; reason: string }[];
  partitioningCandidates: { table: string; strategy: string; reason: string }[];
  queryGuidelines: string[];
}

export interface DatabaseDesign {
  meta: {
    projectName: string;
    projectType: string;
    engine: string;
    databaseVersion: string;
    normalForm: string;
    generatedAt: string;
    generator: string;
  };
  enums: PrismaEnumDesign[];
  tables: TableDesign[];
  relationships: RelationshipDesign[];
  optimization: OptimizationReport;
}

/* ── ER diagram (frontend visualization) ─────────────────────────────── */

export interface ErNodeColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  foreignKey: boolean;
  nullable: boolean;
}

export interface ErNode {
  id: string;
  label: string;
  columns: ErNodeColumn[];
}

export interface ErEdge {
  id: string;
  from: string;
  to: string;
  cardinality: RelationshipCardinality;
  /** Compact label, e.g. `1 — N`. */
  label: string;
  foreignKey: string;
}

export interface ErDiagram {
  nodes: ErNode[];
  edges: ErEdge[];
}

/* ── Validation rules ────────────────────────────────────────────────── */

export interface FieldValidationRule {
  rule:
    | 'required'
    | 'type'
    | 'maxLength'
    | 'minLength'
    | 'min'
    | 'format'
    | 'enum'
    | 'unique'
    | 'foreignKey';
  value?: string | number | string[];
  message: string;
}

export interface FieldValidation {
  field: string;
  type: string;
  rules: FieldValidationRule[];
}

export interface EntityValidation {
  entity: string;
  fields: FieldValidation[];
}

export interface ValidationRuleSet {
  meta: { projectName: string; generatedAt: string };
  entities: EntityValidation[];
}

/* ── Entity metadata ─────────────────────────────────────────────────── */

export interface EntityPermission {
  role: string;
  actions: ('create' | 'read' | 'update' | 'delete')[];
}

export interface EntityMetadata {
  entity: string;
  tableName: string;
  description: string;
  ownership: string;
  permissions: EntityPermission[];
  lifecycle: string[];
  businessRules: string[];
  relationships: { related: string; cardinality: RelationshipCardinality; via: string }[];
}

export interface EntityMetadataSet {
  meta: { projectName: string; generatedAt: string };
  entities: EntityMetadata[];
}

/* ── OpenAPI 3.1 (typed subset we emit) ──────────────────────────────── */

export type JsonSchemaType =
  'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  format?: string;
  description?: string;
  enum?: string[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  $ref?: string;
  example?: unknown;
  default?: unknown;
  nullable?: boolean;
  additionalProperties?: boolean;
}

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  description: string;
  required: boolean;
  schema: JsonSchema;
}

export interface OpenApiMediaType {
  schema: JsonSchema;
}

export interface OpenApiRequestBody {
  required: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security?: { bearerAuth: string[] }[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse | { $ref: string }>;
}

export type OpenApiPathItem = Partial<
  Record<'get' | 'post' | 'put' | 'patch' | 'delete', OpenApiOperation>
>;

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, OpenApiPathItem>;
  components: {
    securitySchemes: Record<string, unknown>;
    parameters: Record<string, OpenApiParameter>;
    responses: Record<string, OpenApiResponse>;
    schemas: Record<string, JsonSchema>;
  };
}

/* ── Integrity report + bundle ───────────────────────────────────────── */

export interface IntegrityIssue {
  severity: 'error' | 'warning';
  location: string;
  message: string;
}

export interface IntegrityReport {
  valid: boolean;
  issues: IntegrityIssue[];
  stats: {
    tables: number;
    columns: number;
    relationships: number;
    indexes: number;
    enums: number;
    endpoints: number;
  };
}

/** Everything Phase 4 produces — the single source of truth downstream. */
export interface DesignBundle {
  databaseDesign: DatabaseDesign;
  prismaSchema: string;
  sqlSchema: string;
  erDiagram: ErDiagram;
  openapi: OpenApiDocument;
  validationRules: ValidationRuleSet;
  entityMetadata: EntityMetadataSet;
  integrity: IntegrityReport;
}
