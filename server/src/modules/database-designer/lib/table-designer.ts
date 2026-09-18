/**
 * TableDesigner: assembles a full `TableDesign` for one architecture entity.
 *
 * Every table follows the platform's relational conventions:
 *   • `id` CHAR(36) UUID primary key
 *   • inferred business columns (from the architecture key-field hints)
 *   • foreign-key columns from the relationship engine
 *   • `created_at` / `updated_at` audit columns, and `deleted_at` for soft
 *     delete (applied universally — deletes are recoverable by default)
 *   • indexes on every foreign key and unique business key
 *
 * Enum columns contribute a shared Prisma enum, collected across all tables.
 */
import type { EntityPlan } from '../../../shared/types/architecture.js';
import { camelCase } from '../../../shared/utils/strings.js';
import type {
  ColumnDesign,
  IndexDesign,
  OnDelete,
  PrismaEnumDesign,
  TableDesign,
} from '../database-designer.types.js';
import { inferColumn, parseKeyField } from './column-inference.js';
import type { InferenceContext } from './column-inference.js';
import { resolveForeignKeys } from './relationship-engine.js';

/** Key-field hints that the designer manages itself and must not re-infer. */
const RESERVED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

function primaryKeyColumn(): ColumnDesign {
  return {
    name: 'id',
    field: 'id',
    sqlType: 'CHAR(36)',
    prismaType: 'String',
    prismaNativeType: '@db.Char(36)',
    nullable: false,
    primaryKey: true,
    unique: true,
    defaultExpression: 'uuid()',
    format: 'uuid',
    description: 'Primary key (UUID v4, generated on insert).',
  };
}

function foreignKeyColumn(
  foreignKey: string,
  parent: string,
  nullable: boolean,
  onDelete: OnDelete,
): ColumnDesign {
  return {
    name: foreignKey,
    field: camelCase(foreignKey),
    sqlType: 'CHAR(36)',
    prismaType: 'String',
    prismaNativeType: '@db.Char(36)',
    nullable,
    primaryKey: false,
    unique: false,
    references: { table: parent, column: 'id', onDelete },
    format: 'uuid',
    description: `Foreign key referencing ${parent}.`,
  };
}

function auditColumns(): ColumnDesign[] {
  return [
    {
      name: 'created_at',
      field: 'createdAt',
      sqlType: 'DATETIME',
      prismaType: 'DateTime',
      nullable: false,
      primaryKey: false,
      unique: false,
      defaultExpression: 'now()',
      description: 'Row creation timestamp.',
    },
    {
      name: 'updated_at',
      field: 'updatedAt',
      sqlType: 'DATETIME',
      prismaType: 'DateTime',
      nullable: false,
      primaryKey: false,
      unique: false,
      onUpdateNow: true,
      description: 'Last modification timestamp (auto-updated).',
    },
    {
      name: 'deleted_at',
      field: 'deletedAt',
      sqlType: 'DATETIME',
      prismaType: 'DateTime',
      nullable: true,
      primaryKey: false,
      unique: false,
      description: 'Soft-delete timestamp; NULL for live rows.',
    },
  ];
}

function buildIndexes(tableName: string, columns: readonly ColumnDesign[]): IndexDesign[] {
  const indexes: IndexDesign[] = [];
  for (const column of columns) {
    if (column.primaryKey) continue;
    if (column.references) {
      indexes.push({
        name: `idx_${tableName}_${column.name}`,
        columns: [column.name],
        unique: false,
        rationale: `Foreign key lookups and joins on ${column.name}.`,
      });
    } else if (column.unique) {
      indexes.push({
        name: `uq_${tableName}_${column.name}`,
        columns: [column.name],
        unique: true,
        rationale: `Enforces uniqueness of ${column.name}.`,
      });
    }
  }
  // Soft-delete + recency composite: the default "live, newest first" query.
  indexes.push({
    name: `idx_${tableName}_deleted_created`,
    columns: ['deleted_at', 'created_at'],
    unique: false,
    rationale: 'Serves the default filter (deleted_at IS NULL) ordered by recency.',
  });
  return indexes;
}

export interface DesignedTable {
  table: TableDesign;
  enums: PrismaEnumDesign[];
}

export function designTable(entity: EntityPlan, context: InferenceContext = {}): DesignedTable {
  const columns: ColumnDesign[] = [primaryKeyColumn()];
  const enums: PrismaEnumDesign[] = [];
  const foreignKeys = resolveForeignKeys(entity);
  const fkNames = new Set(foreignKeys.map((fk) => fk.foreignKey));

  // Business columns from architecture hints (skip reserved + FK columns).
  //
  // A column name may only appear once. keyFields arrives from several
  // places — a built-in rule table, a model's suggestions, an earlier
  // merge — and one duplicate makes the whole Prisma schema invalid, so
  // the run dies at `prisma generate` with every other table fine. Names
  // are claimed here, at the one point every column passes through.
  const claimed = new Set<string>(RESERVED_FIELDS);
  for (const name of fkNames) claimed.add(name);

  for (const raw of entity.keyFields) {
    const parsed = parseKeyField(raw);
    if (claimed.has(parsed.name)) continue;
    claimed.add(parsed.name);
    const column = inferColumn(entity.name, parsed, context);
    columns.push(column);
    if (column.enumValues) {
      enums.push({ name: column.prismaType, values: column.enumValues });
    }
  }

  // Foreign-key columns.
  for (const fk of foreignKeys) {
    columns.push(foreignKeyColumn(fk.foreignKey, fk.parent, fk.nullable, fk.onDelete));
  }

  columns.push(...auditColumns());

  const table: TableDesign = {
    entity: entity.name,
    tableName: entity.tableName,
    columns,
    primaryKey: 'id',
    indexes: buildIndexes(entity.tableName, columns),
    softDelete: true,
    description: `Stores ${entity.name} records.`,
  };

  return { table, enums };
}
