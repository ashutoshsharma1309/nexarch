/**
 * PrismaGenerator: renders the relational design as a `schema.prisma`.
 *
 * Emits a datasource/generator header, one enum block per distinct enum,
 * and one model per table with scalar fields, both sides of every relation
 * (with explicit relation names when a model pair is linked more than once),
 * `@@map` to the physical table, and `@@index` declarations.
 */
import { camelCase, pascalCase } from '../../../shared/utils/strings.js';
import type { ColumnDesign, DatabaseDesign, OnDelete } from '../database-designer.types.js';

const PRISMA_ON_DELETE: Record<OnDelete, string> = {
  CASCADE: 'Cascade',
  RESTRICT: 'Restrict',
  'SET NULL': 'SetNull',
  'NO ACTION': 'NoAction',
};

function fkBase(foreignKey: string): string {
  return foreignKey.endsWith('_id') ? foreignKey.slice(0, -3) : foreignKey;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

interface RelationLines {
  /** Relation fields to add, keyed by owning entity. */
  byEntity: Map<string, string[]>;
}

function buildRelationLines(design: DatabaseDesign): RelationLines {
  const byEntity = new Map<string, string[]>();
  const add = (entity: string, line: string): void => {
    const list = byEntity.get(entity) ?? [];
    list.push(line);
    byEntity.set(entity, list);
  };

  const pairCounts = new Map<string, number>();
  for (const rel of design.relationships) {
    const key = pairKey(rel.child, rel.parent);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  // Track how many relations each parent receives from the same child, to
  // disambiguate back-relation field names.
  const parentChildCounts = new Map<string, number>();
  for (const rel of design.relationships) {
    const key = `${rel.parent}<-${rel.child}`;
    parentChildCounts.set(key, (parentChildCounts.get(key) ?? 0) + 1);
  }
  const parentChildSeen = new Map<string, number>();

  for (const rel of design.relationships) {
    const base = fkBase(rel.foreignKey);
    const needsName = (pairCounts.get(pairKey(rel.child, rel.parent)) ?? 0) > 1;
    const relationName = needsName ? `${rel.child}${pascalCase(base)}` : undefined;

    // Child side: the model that owns the foreign key.
    const childField = camelCase(base);
    const optional = rel.onDelete === 'SET NULL' ? '?' : '';
    const onDeleteAttr =
      rel.onDelete === 'RESTRICT' ? '' : `, onDelete: ${PRISMA_ON_DELETE[rel.onDelete]}`;
    const nameArg = relationName ? `"${relationName}", ` : '';
    add(
      rel.child,
      `${childField} ${rel.parent}${optional} @relation(${nameArg}fields: [${camelCase(rel.foreignKey)}], references: [id]${onDeleteAttr})`,
    );

    // Parent side: the inverse collection (or single, for one-to-one).
    const multiFromSameChild = (parentChildCounts.get(`${rel.parent}<-${rel.child}`) ?? 0) > 1;
    let parentField = camelCase(rel.child);
    if (multiFromSameChild) {
      const seenKey = `${rel.parent}<-${rel.child}`;
      const n = (parentChildSeen.get(seenKey) ?? 0) + 1;
      parentChildSeen.set(seenKey, n);
      parentField = `${camelCase(rel.child)}${pascalCase(base)}`;
    }
    const inverseType = rel.cardinality === 'one-to-one' ? `${rel.child}?` : `${rel.child}[]`;
    const inverseName = relationName ? `@relation("${relationName}")` : '';
    add(rel.parent, `${parentField} ${inverseType} ${inverseName}`.trim());
  }

  return { byEntity };
}

function scalarField(column: ColumnDesign): string {
  const attrs: string[] = [];
  if (column.primaryKey) attrs.push('@id');
  if (column.unique && !column.primaryKey) attrs.push('@unique');
  if (column.defaultExpression === 'uuid()') attrs.push('@default(uuid())');
  else if (column.defaultExpression === 'now()') attrs.push('@default(now())');
  else if (column.enumValues && column.defaultExpression)
    attrs.push(`@default(${column.defaultExpression})`);
  else if (column.defaultExpression === 'false') attrs.push('@default(false)');
  if (column.onUpdateNow) attrs.push('@updatedAt');
  if (column.field !== column.name) attrs.push(`@map("${column.name}")`);
  if (column.prismaNativeType) attrs.push(column.prismaNativeType);

  const optional = column.nullable ? '?' : '';
  return `${column.field} ${column.prismaType}${optional} ${attrs.join(' ')}`.trimEnd();
}

function indexLines(design: DatabaseDesign, tableName: string): string[] {
  const table = design.tables.find((t) => t.tableName === tableName);
  if (!table) return [];
  const lines: string[] = [];
  for (const index of table.indexes) {
    // Single-column unique indexes are already expressed via @unique on the field.
    if (index.unique && index.columns.length === 1) continue;
    const fields = index.columns.map((col) => {
      const column = table.columns.find((c) => c.name === col);
      return column ? column.field : camelCase(col);
    });
    lines.push(`${index.unique ? '@@unique' : '@@index'}([${fields.join(', ')}])`);
  }
  return lines;
}

export function generatePrismaSchema(design: DatabaseDesign): string {
  const relations = buildRelationLines(design);
  const out: string[] = [];

  out.push('// Generated by NexArch Database Designer — do not edit by hand.');
  out.push(`// Project: ${design.meta.projectName} (${design.meta.projectType})`);
  out.push('');
  out.push('generator client {');
  out.push('  provider = "prisma-client-js"');
  out.push('}');
  out.push('');
  out.push('datasource db {');
  out.push('  provider = "mysql"');
  out.push('  url      = env("DATABASE_URL")');
  out.push('}');
  out.push('');

  // Enums (deduplicated by name).
  const seenEnums = new Set<string>();
  for (const enumDef of design.enums) {
    if (seenEnums.has(enumDef.name)) continue;
    seenEnums.add(enumDef.name);
    out.push(`enum ${enumDef.name} {`);
    for (const value of enumDef.values) out.push(`  ${value}`);
    out.push('}');
    out.push('');
  }

  // Models.
  for (const table of design.tables) {
    out.push(`model ${table.entity} {`);
    for (const column of table.columns) {
      out.push(`  ${scalarField(column)}`);
    }
    const relationLines = relations.byEntity.get(table.entity) ?? [];
    if (relationLines.length > 0) {
      out.push('');
      for (const line of relationLines) out.push(`  ${line}`);
    }
    out.push('');
    for (const index of indexLines(design, table.tableName)) {
      out.push(`  ${index}`);
    }
    out.push(`  @@map("${table.tableName}")`);
    out.push('}');
    out.push('');
  }

  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}
